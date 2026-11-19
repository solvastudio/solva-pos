export type LimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number }

export interface Limiter {
  /** Consumes 1 point for `key`. Never throws when the limit is exceeded. */
  consume(key: string, nowMs: number): Promise<LimitDecision>
  /** Inspects remaining points without consuming one. */
  peek(key: string, nowMs: number): Promise<LimitDecision>
  /** Clears counters for `key` (e.g. after successful login or invite reissue). */
  reset(key: string): Promise<void>
}

export type Clock = () => number
