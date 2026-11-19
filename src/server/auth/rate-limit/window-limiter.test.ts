import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLimiters, resetLimitersForTests } from './limiters'
import { rateLimitedResponse } from './rate-limited-response'
import { createWindowLimiter } from './window-limiter'

describe('window-limiter and rate-limit helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
    resetLimitersForTests()
  })

  it('counts points, peeks, and resets deterministically under fake timers', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T00:00:00.000Z'))

    const limiter = createWindowLimiter({
      name: 'test_window',
      points: 2,
      durationSec: 10,
    })

    expect(await limiter.consume('key-1', Date.now())).toEqual({ allowed: true, remaining: 1 })
    expect(await limiter.consume('key-1', Date.now())).toEqual({ allowed: true, remaining: 0 })

    const blocked = await limiter.consume('key-1', Date.now())
    expect(blocked.allowed).toBe(false)
    if (!blocked.allowed) {
      expect(blocked.retryAfterMs).toBeGreaterThan(0)
      expect(blocked.retryAfterMs).toBeLessThanOrEqual(10_000)
    }

    // Separate key is independent.
    expect(await limiter.consume('key-2', Date.now())).toEqual({ allowed: true, remaining: 1 })

    // Window expires after 10 seconds.
    vi.advanceTimersByTime(10_001)
    expect(await limiter.consume('key-1', Date.now())).toEqual({ allowed: true, remaining: 1 })

    await limiter.reset('key-1')
    expect(await limiter.peek('key-1', Date.now())).toEqual({ allowed: true, remaining: 2 })
  })

  it('enforces push and per-tenant report semaphores', () => {
    const prevAppEnv = process.env.APP_ENV
    process.env.APP_ENV = 'development'
    try {
      const { pushSemaphore, reportSemaphore } = getLimiters()

      const releases: Array<() => void> = []
      for (let i = 0; i < 8; i += 1) {
        const rel = pushSemaphore.tryAcquire(`dev-${i}`)
        expect(rel).not.toBeNull()
        releases.push(rel!)
      }
      expect(pushSemaphore.tryAcquire('dev-overflow')).toBeNull()
      // Calling release twice is safe and only decrements once.
      releases[0]!()
      releases[0]!()
      expect(pushSemaphore.activeCount()).toBe(7)
      expect(pushSemaphore.tryAcquire('dev-next')).not.toBeNull()

      const r1 = reportSemaphore.tryAcquire('tenant-a')
      const r2 = reportSemaphore.tryAcquire('tenant-a')
      const r3 = reportSemaphore.tryAcquire('tenant-a')
      const rOther = reportSemaphore.tryAcquire('tenant-b')
      expect(r1).not.toBeNull()
      expect(r2).not.toBeNull()
      expect(r3).toBeNull()
      expect(rOther).not.toBeNull()
      r1!()
      expect(reportSemaphore.tryAcquire('tenant-a')).not.toBeNull()
    } finally {
      process.env.APP_ENV = prevAppEnv
    }
  })

  it('builds interactive and transient 429 responses with Retry-After and optional jitter', async () => {
    const interactive = rateLimitedResponse(90_000, 'interactive', { ref: 'ref-1' })
    expect(interactive.status).toBe(429)
    expect(interactive.headers.get('Retry-After')).toBe('90')
    expect(await interactive.json()).toEqual({
      error: { code: 'RATE_LIMITED', class: 'authorization', ref: 'ref-1' },
      retry_after_minutes: 2,
    })

    const jitterLow = rateLimitedResponse(10_000, 'transient', {
      ref: 'ref-2',
      random: () => 0,
    })
    expect(jitterLow.status).toBe(429)
    expect(jitterLow.headers.get('Retry-After')).toBe('8')
    expect(await jitterLow.json()).toEqual({
      error: { code: 'RATE_LIMITED', ref: 'ref-2' },
    })

    const jitterHigh = rateLimitedResponse(10_000, 'transient', {
      ref: 'ref-3',
      random: () => 1,
    })
    expect(jitterHigh.headers.get('Retry-After')).toBe('12')
  })
})
