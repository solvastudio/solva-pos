import '@tanstack/react-start/server-only'
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'
import type { LimitDecision, Limiter } from '~/lib/ratelimit/limiter'

export interface WindowLimiterOptions {
  name: string
  points: number
  durationSec: number
  blockDurationSec?: number
}

function isRateLimiterRes(value: unknown): value is RateLimiterRes {
  return (
    value instanceof RateLimiterRes ||
    (typeof value === 'object' &&
      value !== null &&
      'msBeforeNext' in value &&
      typeof (value as { msBeforeNext: unknown }).msBeforeNext === 'number')
  )
}

/**
 * Windowed in-memory rate limiter backed by `rate-limiter-flexible`.
 * `RateLimiterMemory` reads `Date.now()` internally for window expirations, so unit/integration
 * tests exercising time progression must use `vi.useFakeTimers()`.
 */
export function createWindowLimiter(options: WindowLimiterOptions): Limiter {
  const rl = new RateLimiterMemory({
    keyPrefix: options.name,
    points: options.points,
    duration: options.durationSec,
    ...(options.blockDurationSec !== undefined
      ? { blockDuration: options.blockDurationSec }
      : {}),
  })

  return {
    async consume(key: string): Promise<LimitDecision> {
      try {
        const res = await rl.consume(key, 1)
        return { allowed: true, remaining: res.remainingPoints }
      } catch (err: unknown) {
        if (isRateLimiterRes(err)) {
          return { allowed: false, retryAfterMs: Math.max(1, err.msBeforeNext) }
        }
        throw err
      }
    },

    async peek(key: string): Promise<LimitDecision> {
      const res = await rl.get(key)
      if (!res) {
        return { allowed: true, remaining: options.points }
      }
      if (res.remainingPoints <= 0 && res.msBeforeNext > 0) {
        return { allowed: false, retryAfterMs: res.msBeforeNext }
      }
      return { allowed: true, remaining: Math.max(0, res.remainingPoints) }
    },

    async reset(key: string): Promise<void> {
      await rl.delete(key)
    },
  }
}
