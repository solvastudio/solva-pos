/**
 * Progressive login delay schedule (index = failure count, 1-based; BR-RLM-003, V-40).
 * Capped at 15 minutes (900,000 ms), with no permanent lockout.
 */
export const LOGIN_DELAY_SCHEDULE_MS: readonly number[] = [
  0, // 0 failures
  0, // 1st failure
  0, // 2nd failure
  0, // 3rd failure
  30_000, // 4th failure: 30s
  60_000, // 5th failure: 1m
  120_000, // 6th failure: 2m
  300_000, // 7th failure: 5m
  900_000, // 8th+ failure: 15m (max)
]

const MAX_DELAY_MS = 900_000

export function loginDelayMs(failureCount: number): number {
  if (!Number.isFinite(failureCount) || failureCount <= 0) {
    return 0
  }
  const index = Math.floor(failureCount)
  if (index >= LOGIN_DELAY_SCHEDULE_MS.length) {
    return MAX_DELAY_MS
  }
  return LOGIN_DELAY_SCHEDULE_MS[index] ?? 0
}

export interface ProgressiveState {
  failures: number
  blockedUntilMs: number
}

export function onLoginFailure(state: ProgressiveState, nowMs: number): ProgressiveState {
  const failures = state.failures + 1
  return {
    failures,
    blockedUntilMs: nowMs + loginDelayMs(failures),
  }
}

export function onLoginSuccess(): ProgressiveState {
  return { failures: 0, blockedUntilMs: 0 }
}

export function isBlocked(
  state: ProgressiveState,
  nowMs: number,
): { blocked: boolean; retryAfterMs: number } {
  const remaining = state.blockedUntilMs - nowMs
  if (remaining > 0) {
    return { blocked: true, retryAfterMs: remaining }
  }
  return { blocked: false, retryAfterMs: 0 }
}
