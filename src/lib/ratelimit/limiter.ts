export type LimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number }

export interface Limiter {
  /**
   * Consumes 1 point for `key`. Never throws when the limit is exceeded.
   * Note: implementations backed by `RateLimiterMemory` (e.g. `createWindowLimiter`)
   * read `Date.now()` internally and ignore `nowMs`, so tests advancing time
   * MUST use `vi.useFakeTimers()`.
   */
  consume(key: string, nowMs: number): Promise<LimitDecision>
  /** Inspects remaining points without consuming one. Reads `Date.now()` in `RateLimiterMemory`. */
  peek(key: string, nowMs: number): Promise<LimitDecision>
  /** Clears counters for `key` (e.g. after successful login or invite reissue). */
  reset(key: string): Promise<void>
}

export type Clock = () => number
