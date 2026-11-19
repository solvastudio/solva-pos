/**
 * Jadwal jeda progresif login (indeks = jumlah gagal, 1-based; BR-RLM-003, V-40).
 * Maksimum 15 menit (900.000 ms), tanpa penguncian permanen.
 */
export const LOGIN_DELAY_SCHEDULE_MS: readonly number[] = [
  0, // 0 gagal
  0, // ke-1
  0, // ke-2
  0, // ke-3
  30_000, // ke-4: 30 detik
  60_000, // ke-5: 1 menit
  120_000, // ke-6: 2 menit
  300_000, // ke-7: 5 menit
  900_000, // ke-8+: 15 menit (maks)
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
