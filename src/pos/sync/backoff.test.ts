import { describe, expect, it } from 'vitest'
import { BACKOFF_BASE_SECONDS, nextDelayMs } from './backoff'

describe('pos/sync/backoff', () => {
  it('computes 5/15/60/300s delays within +-20% jitter and caps at 300s', () => {
    BACKOFF_BASE_SECONDS.forEach((sec, idx) => {
      const min = nextDelayMs(idx, () => 0)
      const max = nextDelayMs(idx, () => 1)
      expect(min).toBe(sec * 800)
      expect(max).toBe(sec * 1_200)
    })

    // Out-of-bounds failure indices clamp safely to index 3 (300s).
    expect(nextDelayMs(99, () => 0.5)).toBe(300_000)
    expect(nextDelayMs(-3, () => 0.5)).toBe(5_000)
  })
})
