import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  isBlocked,
  LOGIN_DELAY_SCHEDULE_MS,
  loginDelayMs,
  onLoginFailure,
  onLoginSuccess,
  type ProgressiveState,
} from './progressive'

describe('kebijakan jeda progresif login (BR-RLM-003, V-40)', () => {
  it('mengikuti tabel V-40 persis untuk gagal ke-1 sampai ke-10', () => {
    const expected: Array<[number, number]> = [
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 30_000],
      [5, 60_000],
      [6, 120_000],
      [7, 300_000],
      [8, 900_000],
      [9, 900_000],
      [10, 900_000],
    ]

    for (const [failures, ms] of expected) {
      expect(loginDelayMs(failures)).toBe(ms)
    }
    expect(LOGIN_DELAY_SCHEDULE_MS[8]).toBe(900_000)
  })

  it('memeriksa isBlocked sebelum, tepat pada, dan sesudah blockedUntilMs', () => {
    let state: ProgressiveState = onLoginSuccess()
    const t0 = 1_000_000

    for (let i = 1; i <= 3; i += 1) {
      state = onLoginFailure(state, t0)
      expect(isBlocked(state, t0)).toEqual({ blocked: false, retryAfterMs: 0 })
    }

    // Gagal ke-4 -> jeda 30_000 ms
    state = onLoginFailure(state, t0)
    expect(state).toEqual({ failures: 4, blockedUntilMs: t0 + 30_000 })
    expect(isBlocked(state, t0)).toEqual({ blocked: true, retryAfterMs: 30_000 })
    expect(isBlocked(state, t0 + 29_999)).toEqual({ blocked: true, retryAfterMs: 1 })
    expect(isBlocked(state, t0 + 30_000)).toEqual({ blocked: false, retryAfterMs: 0 })
    expect(isBlocked(state, t0 + 50_000)).toEqual({ blocked: false, retryAfterMs: 0 })
  })

  it('mereset hitungan dan jeda saat login sukses tanpa penguncian permanen', () => {
    let state = onLoginSuccess()
    for (let i = 0; i < 8; i += 1) {
      state = onLoginFailure(state, 10_000)
    }
    expect(isBlocked(state, 10_000).blocked).toBe(true)

    const reset = onLoginSuccess()
    expect(reset).toEqual({ failures: 0, blockedUntilMs: 0 })
    expect(isBlocked(reset, 10_000)).toEqual({ blocked: false, retryAfterMs: 0 })
  })

  it('properti: loginDelayMs monoton tak turun dan tidak pernah melebihi 900_000 ms', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (a, b) => {
          const lo = Math.min(a, b)
          const hi = Math.max(a, b)
          expect(loginDelayMs(lo)).toBeLessThanOrEqual(loginDelayMs(hi))
          expect(loginDelayMs(lo)).toBeGreaterThanOrEqual(0)
          expect(loginDelayMs(hi)).toBeLessThanOrEqual(900_000)
        },
      ),
    )
  })
})
