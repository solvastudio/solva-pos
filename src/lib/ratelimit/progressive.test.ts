import { describe, expect, it } from 'vitest'
import { LOGIN_DELAY_SCHEDULE_MS } from './progressive'

describe('progressive login delay schedule constant (BR-RLM-003, V-40)', () => {
  it('matches the V-40 schedule and caps at 900,000 ms without permanent lockout', () => {
    expect(LOGIN_DELAY_SCHEDULE_MS).toEqual([
      0,
      0,
      0,
      0,
      30_000,
      60_000,
      120_000,
      300_000,
      900_000,
    ])
  })

  it('is monotonically non-decreasing across failure indices', () => {
    for (let i = 1; i < LOGIN_DELAY_SCHEDULE_MS.length; i += 1) {
      expect(LOGIN_DELAY_SCHEDULE_MS[i]!).toBeGreaterThanOrEqual(
        LOGIN_DELAY_SCHEDULE_MS[i - 1]!,
      )
    }
  })
})
