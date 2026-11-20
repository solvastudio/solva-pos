/**
 * Canonical V-40 progressive login delay schedule (index = failure count; BR-RLM-003, V-40).
 * Capped at 15 minutes (900,000 ms), with no permanent lockout.
 * Consumed by `src/lib/ratelimit/login-policy.ts`.
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
