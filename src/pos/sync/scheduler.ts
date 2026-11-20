import { getEarliestDeferredRetryAt } from '../data/outbox.repo'
import { setMeta } from '../data/meta.repo'
import type { SolvaDb } from '../db/solva-db'
import { withResourceLock } from '../locks/resource-lock'
import type { LockManagerLike } from '../locks/instance-lock'
import { nextDelayMs } from './backoff'
import type { SyncClock } from './clock'
import type { ConnectivityMonitor } from './connectivity'

export type SyncKickReason =
  | 'boot'
  | 'focus'
  | 'online'
  | 'interval'
  | 'finalized'
  | 'signal'
  | 'manual'

export const ONLINE_POLL_INTERVAL_MS = 60_000

const IMMEDIATE_BYPASS_REASONS = new Set<SyncKickReason>(['online', 'signal', 'finalized', 'manual'])

export interface CycleOutcome {
  pushOk: boolean
  pullOk: boolean
  rateLimitedMs?: number
  serverTimeMs?: number
  terminalAuthLock?: boolean
  updateRequired?: boolean
}

export interface SyncSchedulerOptions {
  db: SolvaDb
  tenantId: string
  deviceId: string
  clock: SyncClock
  connectivity: ConnectivityMonitor
  locks?: LockManagerLike | null
  rng?: () => number
  nowMs?: () => number
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (id: unknown) => void
  setIntervalFn?: (fn: () => void, ms: number) => unknown
  clearIntervalFn?: (id: unknown) => void
  runPushStep: () => Promise<{
    kind: 'ok' | 'rate_limited' | 'auth' | 'update_required' | 'transient'
    pushOk?: boolean
    retryAfterMs?: number
    serverTimeMs?: number
  }>
  runPullStep: (pushOk: boolean) => Promise<{
    kind: 'ok' | 'rate_limited' | 'auth' | 'update_required' | 'transient' | 'full_resync_required'
    retryAfterMs?: number
    serverTimeMs?: number
  }>
  runFullResyncStep: (pushOk: boolean) => Promise<{
    kind: 'ok' | 'rate_limited' | 'failed'
    retryAfterMs?: number
    serverTimeMs?: number
  }>
  onCycleFinished?: (outcome: CycleOutcome) => void
  onSyncingChanged?: (syncing: boolean) => void
  onStoppedTerminal?: () => void
}

export interface SyncScheduler {
  kick(reason: SyncKickReason): void
  start(): void
  stop(): void
  waitForIdle(): Promise<void>
  runNowForTests(): Promise<void>
}

/**
 * Coordinates single-flight sync cycles (`probe -> push -> pull(+apply) -> status`)
 * under the exclusive `'sync'` resource lock, coalescing concurrent kicks into one trailing run
 * and honoring jittered exponential backoff with one-shot bypass on urgent triggers.
 */
export function createSyncScheduler(opts: SyncSchedulerOptions): SyncScheduler {
  const rng = opts.rng ?? (() => 0.5)
  const nowMs = opts.nowMs ?? (() => opts.clock.trustedNow())
  const setTimer = opts.setTimeoutFn ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const clearTimer =
    opts.clearTimeoutFn ??
    ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>))
  const setInt = opts.setIntervalFn ?? ((fn, ms) => globalThis.setInterval(fn, ms))
  const clearInt =
    opts.clearIntervalFn ??
    ((id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>))

  let running = false
  let pendingFollowUp = false
  let activeLoopPromise: Promise<void> | null = null
  let stopped = false
  let failureIndex = 0
  let backoffUntilMs = 0
  let backoffTimer: unknown = null
  let pollIntervalId: unknown = null

  function clearBackoffTimer() {
    if (backoffTimer !== null) {
      clearTimer(backoffTimer)
      backoffTimer = null
    }
  }

  function scheduleBackoffRetry(explicitMs?: number) {
    if (stopped) return
    clearBackoffTimer()
    const delayMs = explicitMs ?? nextDelayMs(failureIndex, rng)
    if (explicitMs === undefined) {
      failureIndex += 1
    }
    backoffUntilMs = nowMs() + delayMs
    backoffTimer = setTimer(() => {
      backoffTimer = null
      void executeLoop()
    }, delayMs)
  }

  async function executeSingleCycle(): Promise<void> {
    if (stopped) return

    await withResourceLock({
      tenantId: opts.tenantId,
      deviceId: opts.deviceId,
      name: 'sync',
      locks: opts.locks,
      fn: async () => {
        if (stopped) return

        // 1. Connectivity probe first if currently not idle online.
        const connState = await opts.connectivity.probeNow()
        if (connState === 'OFFLINE') {
          scheduleBackoffRetry()
          return
        }

        opts.onSyncingChanged?.(true)
        opts.connectivity.markSyncing(true)

        try {
          // 2. Push outgoing outbox queue.
          const pushRes = await opts.runPushStep()
          if (pushRes.kind === 'auth') {
            if (pushRes.kind === 'auth') {
              opts.onStoppedTerminal?.()
            }
            return
          }
          if (pushRes.kind === 'rate_limited') {
            opts.connectivity.reportRateLimited()
            scheduleBackoffRetry(pushRes.retryAfterMs)
            return
          }

          const pushOk = pushRes.kind === 'ok' && Boolean(pushRes.pushOk)
          if (pushRes.kind === 'transient') {
            opts.connectivity.reportHttpTransportFailure()
            scheduleBackoffRetry()
            return
          }

          // 3. Pull incoming master changes (+ atomic stage/apply).
          let pullRes = await opts.runPullStep(pushOk)
          if (pullRes.kind === 'full_resync_required') {
            const fullRes = await opts.runFullResyncStep(pushOk)
            if (fullRes.kind === 'rate_limited') {
              opts.connectivity.reportRateLimited()
              scheduleBackoffRetry(fullRes.retryAfterMs)
              return
            }
            if (fullRes.kind !== 'ok') {
              scheduleBackoffRetry()
              return
            }
            pullRes = { kind: 'ok', serverTimeMs: fullRes.serverTimeMs }
          }

          if (pullRes.kind === 'auth') {
            opts.onStoppedTerminal?.()
            return
          }
          if (pullRes.kind === 'rate_limited') {
            opts.connectivity.reportRateLimited()
            scheduleBackoffRetry(pullRes.retryAfterMs)
            return
          }
          if (pullRes.kind === 'transient') {
            opts.connectivity.reportHttpTransportFailure()
            scheduleBackoffRetry()
            return
          }

          const pullOk = pullRes.kind === 'ok'
          opts.connectivity.reportHttpSuccess()

          if (pushOk && pullOk && !stopped && opts.db.isOpen()) {
            const deferredAtIso = await getEarliestDeferredRetryAt(opts.db)
            if (deferredAtIso !== null) {
              const deferredMs = Date.parse(deferredAtIso)
              const delayMs = Number.isFinite(deferredMs)
                ? Math.max(50, deferredMs - nowMs())
                : undefined
              scheduleBackoffRetry(delayMs)
            } else {
              failureIndex = 0
              backoffUntilMs = 0
            }
            const syncIso = new Date(
              pullRes.serverTimeMs ?? pushRes.serverTimeMs ?? opts.clock.trustedNow(),
            ).toISOString()
            await setMeta(opts.db, 'last_success_sync_at', syncIso)
            if (stopped || !opts.db.isOpen()) return
            await opts.clock.recordSample({
              tSendDeviceMs: opts.clock.trustedNow(),
              rttMs: 0,
              serverTimeMs: Date.parse(syncIso),
            })
          } else if (!stopped) {
            scheduleBackoffRetry()
          }

          opts.onCycleFinished?.({
            pushOk,
            pullOk,
            serverTimeMs: pullRes.serverTimeMs ?? pushRes.serverTimeMs,
            updateRequired:
              pushRes.kind === 'update_required' || pullRes.kind === 'update_required',
          })
        } finally {
          opts.connectivity.markSyncing(false)
          opts.onSyncingChanged?.(false)
        }
      },
    })
  }

  async function executeLoop(): Promise<void> {
    if (stopped) return
    if (running) {
      pendingFollowUp = true
      return
    }
    running = true
    const runPromise = (async () => {
      try {
        do {
          pendingFollowUp = false
          await executeSingleCycle()
        } while (pendingFollowUp && !stopped)
      } catch (err) {
        if (!stopped && opts.db.isOpen()) {
          throw err
        }
      } finally {
        running = false
        activeLoopPromise = null
      }
    })()
    activeLoopPromise = runPromise
    await runPromise
  }

  return {
    kick(reason: SyncKickReason) {
      if (stopped) return
      const bypass = IMMEDIATE_BYPASS_REASONS.has(reason)
      if (running) {
        pendingFollowUp = true
        return
      }
      if (!bypass && nowMs() < backoffUntilMs) {
        return
      }
      if (bypass) {
        clearBackoffTimer()
        backoffUntilMs = 0
      }
      void executeLoop()
    },
    start() {
      stopped = false
      if (pollIntervalId === null) {
        pollIntervalId = setInt(() => {
          if (opts.connectivity.state !== 'OFFLINE') {
            this.kick('interval')
          }
        }, ONLINE_POLL_INTERVAL_MS)
      }
      if (
        opts.connectivity.state !== 'OFFLINE' ||
        typeof navigator === 'undefined' ||
        navigator.onLine !== false
      ) {
        this.kick('boot')
      }
    },
    stop() {
      stopped = true
      pendingFollowUp = false
      clearBackoffTimer()
      if (pollIntervalId !== null) {
        clearInt(pollIntervalId)
        pollIntervalId = null
      }
    },
    async waitForIdle(): Promise<void> {
      if (activeLoopPromise) {
        await activeLoopPromise
      }
    },
    async runNowForTests(): Promise<void> {
      await executeLoop()
    },
  }
}
