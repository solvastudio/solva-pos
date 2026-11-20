import type { SyncClock } from './clock'

export type ConnectivityState = 'OFFLINE' | 'PROBING' | 'ONLINE_IDLE' | 'SYNCING' | 'UNSTABLE'

export const PING_TIMEOUT_MS = 4_000
export const OFFLINE_SANITY_PROBE_MS = 60_000
export const PROBE_FAIL_MIN_MS = 15_000
export const PROBE_FAIL_MAX_MS = 60_000
export const FLAP_WINDOW_MS = 120_000
export const FLAP_COUNT_FOR_UNSTABLE = 3
export const UNSTABLE_STABILIZE_MS = 60_000

export interface ConnectivityMonitorOptions {
  fetch?: typeof fetch
  nowMs?: () => number
  rng?: () => number
  isNavigatorOnline?: () => boolean
  clock?: SyncClock | null
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (id: unknown) => void
  onOnlineTransition?: () => void
  onStateChange?: (state: ConnectivityState) => void
}

export interface ConnectivityMonitor {
  readonly state: ConnectivityState
  readonly consecutiveFailures: number
  isUnstable(): boolean
  probeNow(): Promise<ConnectivityState>
  handleBrowserOnline(): void
  handleBrowserOffline(): void
  markSyncing(syncing: boolean): void
  reportHttpSuccess(): void
  reportHttpTransportFailure(): void
  reportRateLimited(): void
  start(): void
  stop(): void
}

/**
 * Connectivity state machine with /api/pos/v1/ping captive-portal rejection,
 * online<->offline hysteresis (2 failures to offline, 1 success to online),
 * 429 neutrality, and UNSTABLE flapping detection (>= 3 transitions / 2 min).
 */
export function createConnectivityMonitor(
  opts: ConnectivityMonitorOptions = {},
): ConnectivityMonitor {
  const fetchFn = opts.fetch ?? globalThis.fetch
  const nowMs = opts.nowMs ?? (() => Date.now())
  const rng = opts.rng ?? (() => 0.5)
  const isNavOnline =
    opts.isNavigatorOnline ??
    (() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const setTimer = opts.setTimeoutFn ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const clearTimer =
    opts.clearTimeoutFn ??
    ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>))

  let currentState: ConnectivityState = isNavOnline() ? 'PROBING' : 'OFFLINE'
  let unstableUntilMs = 0
  let consecutiveFailures = 0
  let nextRetryDelayMs = PROBE_FAIL_MIN_MS
  let timerId: unknown = null
  let stopped = false
  let probingPromise: Promise<ConnectivityState> | null = null
  const flapTimestamps: number[] = []
  let lastReachable: boolean | null = null

  function isCurrentlyUnstable(): boolean {
    return nowMs() < unstableUntilMs
  }

  function recordTransition(toReachable: boolean): void {
    if (lastReachable === null) {
      lastReachable = toReachable
      return
    }
    if (toReachable === lastReachable) return
    lastReachable = toReachable
    const t = nowMs()
    flapTimestamps.push(t)
    const cutoff = t - FLAP_WINDOW_MS
    while (flapTimestamps.length > 0 && flapTimestamps[0]! < cutoff) {
      flapTimestamps.shift()
    }
    if (flapTimestamps.length >= FLAP_COUNT_FOR_UNSTABLE) {
      unstableUntilMs = t + UNSTABLE_STABILIZE_MS
    }
  }

  function emitState(next: ConnectivityState): void {
    if (next === currentState) return
    currentState = next
    opts.onStateChange?.(next)
  }

  function scheduleNextProbe(delayMs: number): void {
    if (stopped) return
    if (timerId !== null) {
      clearTimer(timerId)
      timerId = null
    }
    timerId = setTimer(() => {
      timerId = null
      void probeNow()
    }, delayMs)
  }

  function applyProbeFailure(viaOfflineEvent: boolean): void {
    consecutiveFailures += 1
    const hitOffline = viaOfflineEvent || consecutiveFailures >= 2 || currentState === 'OFFLINE'
    if (hitOffline) {
      recordTransition(false)
      emitState('OFFLINE')
    }
    if (!isNavOnline()) {
      scheduleNextProbe(OFFLINE_SANITY_PROBE_MS)
      return
    }
    const delay = nextRetryDelayMs
    nextRetryDelayMs = Math.min(PROBE_FAIL_MAX_MS, nextRetryDelayMs * 2)
    scheduleNextProbe(delay)
  }

  function applyProbeSuccess(): void {
    const wasOffline = lastReachable === false
    consecutiveFailures = 0
    nextRetryDelayMs = PROBE_FAIL_MIN_MS
    recordTransition(true)

    const targetState: ConnectivityState = isCurrentlyUnstable() ? 'UNSTABLE' : 'ONLINE_IDLE'
    emitState(targetState)
    if (wasOffline) {
      opts.onOnlineTransition?.()
    }
  }

  async function probeNow(): Promise<ConnectivityState> {
    if (probingPromise) {
      return probingPromise
    }
    probingPromise = (async () => {
      const tSend = nowMs()
      const pStart = typeof performance !== 'undefined' ? performance.now() : tSend

      try {
        const res = await fetchFn('/api/pos/v1/ping', {
          method: 'GET',
          cache: 'no-store',
          signal:
            typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
              ? AbortSignal.timeout(PING_TIMEOUT_MS)
              : undefined,
        })

        if (res.status === 429) {
          // 429 is NOT a connectivity failure (BR / §4.4).
          return currentState
        }

        const appVer = res.headers.get('X-App-Version')
        if (res.status !== 200 || !appVer || !appVer.trim()) {
          applyProbeFailure(false)
          return currentState
        }

        const json = (await res.json()) as { ok?: unknown; server_time?: unknown }
        if (json?.ok !== true || typeof json.server_time !== 'number') {
          applyProbeFailure(false)
          return currentState
        }

        const pEnd = typeof performance !== 'undefined' ? performance.now() : nowMs()
        if (opts.clock) {
          await opts.clock.recordSample({
            tSendDeviceMs: tSend,
            rttMs: Math.max(0, pEnd - pStart),
            serverTimeMs: json.server_time,
          })
        }

        applyProbeSuccess()
        return currentState
      } catch {
        applyProbeFailure(false)
        return currentState
      } finally {
        probingPromise = null
      }
    })()

    return probingPromise
  }

  return {
    get state() {
      return currentState
    },
    get consecutiveFailures() {
      return consecutiveFailures
    },
    isUnstable: () => currentState === 'UNSTABLE' || isCurrentlyUnstable(),
    probeNow,
    handleBrowserOnline() {
      const jitterMs = Math.round(Math.max(0, Math.min(1, rng())) * 2_000)
      scheduleNextProbe(jitterMs)
    },
    handleBrowserOffline() {
      applyProbeFailure(true)
    },
    markSyncing(syncing: boolean) {
      if (syncing) {
        if (currentState === 'ONLINE_IDLE' || currentState === 'UNSTABLE') {
          emitState('SYNCING')
        }
        return
      }
      if (currentState === 'SYNCING') {
        emitState(isCurrentlyUnstable() ? 'UNSTABLE' : 'ONLINE_IDLE')
      }
    },
    reportHttpSuccess() {
      applyProbeSuccess()
    },
    reportHttpTransportFailure() {
      applyProbeFailure(false)
    },
    reportRateLimited() {
      // Explicitly neutral per §4.4.
    },
    start() {
      stopped = false
      if (!isNavOnline()) {
        emitState('OFFLINE')
        scheduleNextProbe(OFFLINE_SANITY_PROBE_MS)
      } else {
        void probeNow()
      }
    },
    stop() {
      stopped = true
      if (timerId !== null) {
        clearTimer(timerId)
        timerId = null
      }
    },
  }
}
