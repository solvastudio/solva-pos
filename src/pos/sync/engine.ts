import { APP_VERSION } from '~/lib/app-version'
import { SCHEMA_VERSION } from '~/lib/contracts'
import { getMeta } from '../data/meta.repo'
import {
  getOutboxQueueSummary,
  resetSending,
  subscribeSyncStateInputs,
} from '../data/outbox.repo'
import type { SolvaDb } from '../db/solva-db'
import type { LockManagerLike } from '../locks/instance-lock'
import { withResourceLock } from '../locks/resource-lock'
import { logDevice } from '../maintenance/device-log'
import { scheduleRetentionOnIdle } from '../maintenance/retention'
import { checkAndPruneStorage } from '../maintenance/storage'
import { computeDeviceState } from '../session/device-state'
import { createSyncClock } from './clock'
import { createConnectivityMonitor } from './connectivity'
import { runFullResync, type FullResyncProgress } from './full-resync'
import { runDeviceLogShipper } from './log-shipper'
import { runIncrementalPull } from './puller'
import { runPush } from './pusher'
import { evaluateRelease } from './release-state'
import { createSyncScheduler, type SyncKickReason } from './scheduler'
import { createSignalsClient } from './signals'
import {
  createInitialSyncState,
  createSyncStateStore,
  type SyncState,
  type SyncStateStore,
} from './sync-state'

export interface StartSyncEngineOptions {
  db: SolvaDb
  tenantId: string
  deviceId: string
  isPrimaryLock: boolean
  locks?: LockManagerLike | null
  fetch?: typeof fetch
  nowMs?: () => number
  onTerminalLockDetected?: (
    code: 'DEVICE_REVOKED' | 'CREDENTIAL_EXPIRED' | 'TENANT_SUSPENDED',
  ) => void
}

export interface SyncController {
  readonly active: boolean
  readonly store: SyncStateStore
  kick(reason: SyncKickReason): void
  runFullResync(onProgress?: (p: FullResyncProgress) => void): Promise<'OK' | 'FAILED'>
  stop(): void
  waitForIdle?(): Promise<void>
}

const sharedStore: SyncStateStore = createSyncStateStore(createInitialSyncState())
let activeController: SyncController | null = null

export function getGlobalSyncStore(): SyncStateStore {
  return sharedStore
}

export function kickActiveSync(reason: SyncKickReason = 'manual'): void {
  activeController?.kick(reason)
}

/**
 * Starts the full client sync engine for the active primary tab only.
 * Resets stale `SENDING` commands on startup, wires clock, connectivity probe,
 * SSE signals, scheduler, and live Dexie queue projections into `SyncStateStore`.
 */
export async function startSyncEngine(
  opts: StartSyncEngineOptions,
): Promise<SyncController> {
  if (!opts.isPrimaryLock) {
    return {
      active: false,
      store: sharedStore,
      kick: () => {},
      runFullResync: async () => 'FAILED',
      stop: () => {},
    }
  }

  if (activeController) {
    activeController.stop()
  }

  const nowMs = opts.nowMs ?? (() => Date.now())
  await withResourceLock({
    tenantId: opts.tenantId,
    deviceId: opts.deviceId,
    name: 'sync',
    locks: opts.locks,
    fn: () => resetSending(opts.db),
  })

  const initialClockMeta = await getMeta(opts.db, 'clock')
  const clock = createSyncClock({
    db: opts.db,
    initialMeta: initialClockMeta,
    nowMs,
    onClockAnomaly: () => {
      void logDevice(opts.db, {
        level: 'warn',
        code: 'CLOCK_ANOMALY',
        ctx: { offsetMs: clock.getOffsetMs() },
      }).catch(() => {})
    },
  })

  let stopped = false

  async function refreshDexieSnapshot() {
    if (stopped || !opts.db.isOpen()) return
    let queue: Awaited<ReturnType<typeof getOutboxQueueSummary>>
    let lastSync: Awaited<ReturnType<typeof getMeta<'last_success_sync_at'>>>
    let syncFlags: Awaited<ReturnType<typeof getMeta<'sync_flags'>>>
    let minSupported: Awaited<ReturnType<typeof getMeta<'min_supported'>>>
    try {
      ;[queue, lastSync, syncFlags, minSupported] = await Promise.all([
        getOutboxQueueSummary(opts.db),
        getMeta(opts.db, 'last_success_sync_at'),
        getMeta(opts.db, 'sync_flags'),
        getMeta(opts.db, 'min_supported'),
      ])
    } catch (err) {
      if (stopped || !opts.db.isOpen()) return
      throw err
    }
    if (stopped) return

    const lastSyncMs = lastSync ? Date.parse(lastSync) : null
    const devState = computeDeviceState({
      hasDevice: true,
      trustedNowMs: clock.trustedNow(),
      lastSuccessSyncAtMs: lastSyncMs !== null && Number.isFinite(lastSyncMs) ? lastSyncMs : null,
      maxSeenTimeMs: clock.getMaxSeenMs(),
      flags: {
        revoked: syncFlags?.revoked,
        credentialExpired: syncFlags?.credential_expired,
        tenantSuspended: syncFlags?.tenant_suspended,
        updateRequired: syncFlags?.update_required,
      },
    })

    let deviceBanner: SyncState['device'] = 'OK'
    let leaseHoursLeft: number | undefined
    if (devState.kind === 'LEASE_WARNING') {
      deviceBanner = 'LEASE_WARNING'
      leaseHoursLeft = devState.hoursLeft
    } else if (
      devState.kind === 'LOCKED_LEASE' ||
      devState.kind === 'LOCKED_CLOCK' ||
      devState.kind === 'REVOKED' ||
      devState.kind === 'CREDENTIAL_EXPIRED' ||
      devState.kind === 'TENANT_SUSPENDED'
    ) {
      deviceBanner = 'LOCKED'
    }

    const relEval = minSupported
      ? evaluateRelease(
          {
            latest: minSupported.latest ?? minSupported.app_version,
            min_supported_app_version: minSupported.app_version,
            min_supported_schema_version: minSupported.schema_version,
            is_mandatory: minSupported.is_mandatory,
            accept_previous_until: minSupported.accept_previous_until ?? null,
            max_schema_version: minSupported.max_schema_version ?? minSupported.schema_version,
          },
          { appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION },
          clock.trustedNow(),
        )
      : 'UP_TO_DATE'

    const updateState: SyncState['update'] =
      syncFlags?.update_required || relEval === 'REQUIRED'
        ? 'REQUIRED'
        : relEval === 'HARD'
          ? 'PENDING_APPLY'
          : relEval === 'SOFT'
            ? 'AVAILABLE'
            : 'NONE'

    const serverBehind = Boolean(syncFlags?.server_behind) || relEval === 'SERVER_BEHIND'

    sharedStore.patch({
      queue: {
        pending: queue.pending,
        oldestAt: queue.oldestAt,
        attention: queue.attention,
      },
      device: deviceBanner,
      leaseHoursLeft,
      update: updateState,
      serverBehind,
      lastSuccessAt: lastSync,
      clockWarning: clock.offsetWarning(),
    })
  }

  let schedulerRef: ReturnType<typeof createSyncScheduler> | null = null

  const connectivity = createConnectivityMonitor({
    fetch: opts.fetch,
    rng: Math.random,
    nowMs,
    clock,
    onStateChange: (conn) => {
      sharedStore.patch({
        conn,
        syncingSinceMs: conn === 'SYNCING' ? nowMs() : null,
      })
    },
    onOnlineTransition: () => {
      sseClient.start()
      schedulerRef?.kick('online')
    },
  })

  const sseClient = createSignalsClient({
    db: opts.db,
    fetch: opts.fetch,
    rng: Math.random,
    onSignal: (msg) => {
      if (msg.t === 'pull' || msg.t === 'release' || msg.t === 'bills') {
        schedulerRef?.kick('signal')
      }
    },
    onAuthTerminal: () => {
      schedulerRef?.stop()
      sseClient.stop()
      connectivity.stop()
    },
  })

  const scheduler = createSyncScheduler({
    db: opts.db,
    tenantId: opts.tenantId,
    deviceId: opts.deviceId,
    clock,
    connectivity,
    locks: opts.locks,
    rng: Math.random,
    runPushStep: () =>
      runPush({
        db: opts.db,
        clock,
        unstable: connectivity.isUnstable(),
        fetch: opts.fetch,
        rng: Math.random,
        onAuthTerminal: opts.onTerminalLockDetected,
      }),
    runPullStep: (pushOk) =>
      runIncrementalPull({
        db: opts.db,
        clock,
        pushOk,
        unstable: connectivity.isUnstable(),
        fetch: opts.fetch,
        onAuthTerminal: opts.onTerminalLockDetected,
      }),
    runFullResyncStep: (pushOk) =>
      runFullResync({
        db: opts.db,
        clock,
        pushOk,
        fetch: opts.fetch,
        onAuthTerminal: opts.onTerminalLockDetected,
      }),
    runLogShipStep: () =>
      runDeviceLogShipper({
        db: opts.db,
        clock,
        fetch: opts.fetch,
        onAuthTerminal: opts.onTerminalLockDetected,
      }).then(() => {}),
    onCycleFinished: () => {
      void refreshDexieSnapshot().catch(() => {})
      void checkAndPruneStorage(opts.db, {
        trustedNowMs: clock.trustedNow(),
      }).catch(() => {})
    },
    onStoppedTerminal: () => {
      sseClient.stop()
      connectivity.stop()
    },
  })
  schedulerRef = scheduler

  await refreshDexieSnapshot()
  const unsubDexie = subscribeSyncStateInputs(opts.db, () => {
    void refreshDexieSnapshot().catch(() => {})
  })

  const onWindowOnline = () => connectivity.handleBrowserOnline()
  const onWindowOffline = () => connectivity.handleBrowserOffline()
  const onFocusOrVisible = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      scheduler.kick('focus')
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onWindowOnline)
    window.addEventListener('offline', onWindowOffline)
    window.addEventListener('focus', onFocusOrVisible)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onFocusOrVisible)
  }

  connectivity.start()
  sseClient.start()
  scheduler.start()
  const cancelRetention = scheduleRetentionOnIdle(opts.db, {
    trustedNowMs: () => clock.trustedNow(),
  })

  const controller: SyncController = {
    active: true,
    store: sharedStore,
    kick: (reason) => scheduler.kick(reason),
    runFullResync: async (onProgress) => {
      const res = await runFullResync({
        db: opts.db,
        clock,
        fetch: opts.fetch,
        onProgress,
        onAuthTerminal: opts.onTerminalLockDetected,
      })
      await refreshDexieSnapshot()
      return res.kind === 'ok' ? 'OK' : 'FAILED'
    },
    stop: () => {
      stopped = true
      cancelRetention()
      unsubDexie()
      sseClient.stop()
      scheduler.stop()
      connectivity.stop()
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onWindowOnline)
        window.removeEventListener('offline', onWindowOffline)
        window.removeEventListener('focus', onFocusOrVisible)
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onFocusOrVisible)
      }
      if (activeController === controller) {
        activeController = null
      }
    },
    waitForIdle: () => scheduler.waitForIdle(),
  }

  activeController = controller
  return controller
}
