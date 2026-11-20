export const IDLE_LOCK_TIMEOUT_MS = 10 * 60 * 1000
export const IDLE_LOCK_CHECK_INTERVAL_MS = 15 * 1000

export interface IdleLockControllerOptions {
  timeoutMs?: number
  checkIntervalMs?: number
  perfNow?: () => number
  isPaused: () => boolean
  isActive: () => boolean
  onLock: () => void | Promise<void>
}

export interface IdleLockController {
  markActivity(): void
  tick(): void
  remainingMs(): number
  stop(): void
}

/**
 * 10-minute inactivity lock controller anchored strictly to monotonic `performance.now()`
 * (immune to wall-clock jumps) that freezes countdown while `isPaused()` is true
 * (e.g. `paymentInProgress` or `supervisorDialogOpen`) per BR-AUT-015 & FLOW-20.
 */
export function createIdleLockController(
  opts: IdleLockControllerOptions,
): IdleLockController {
  const timeoutMs = opts.timeoutMs ?? IDLE_LOCK_TIMEOUT_MS
  const checkIntervalMs = opts.checkIntervalMs ?? IDLE_LOCK_CHECK_INTERVAL_MS
  const perfNow =
    opts.perfNow ??
    (() => (typeof performance !== 'undefined' ? performance.now() : 0))

  let remaining = timeoutMs
  let lastTickPerf = perfNow()
  let triggered = false
  let stopped = false

  function advanceBudget() {
    const nowPerf = perfNow()
    const delta = Math.max(0, nowPerf - lastTickPerf)
    lastTickPerf = nowPerf
    if (!opts.isActive() || opts.isPaused() || triggered) {
      return
    }
    remaining = Math.max(0, remaining - delta)
  }

  function markActivity() {
    if (stopped || !opts.isActive()) return
    lastTickPerf = perfNow()
    remaining = timeoutMs
    triggered = false
  }

  function tick() {
    if (stopped) return
    advanceBudget()
    if (!triggered && opts.isActive() && !opts.isPaused() && remaining <= 0) {
      triggered = true
      void opts.onLock()
    }
  }

  const timer = setInterval(tick, checkIntervalMs)

  return {
    markActivity,
    tick,
    remainingMs() {
      advanceBudget()
      return remaining
    },
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
    },
  }
}
