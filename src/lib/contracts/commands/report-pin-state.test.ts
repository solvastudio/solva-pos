import { describe, expect, it } from 'vitest'
import { parseCommandPayload } from './index'
import { ReportPinStatePayloadV1 } from './report-pin-state'

const USER_ID = '01950000-0000-7000-8000-000000000010'

describe('contracts/commands/ReportPinState v1', () => {
  it('accepts unlocked, timed-lock (tier 1/2), and needs-reset (tier 3) payloads', () => {
    const unlocked = ReportPinStatePayloadV1.parse({
      user_id: USER_ID,
      failed_count: 0,
      lock_tier: 0,
      locked_until: null,
      last_failed_at: null,
      pin_epoch_seen: 2,
    })
    expect(unlocked.failed_count).toBe(0)

    const tier1 = parseCommandPayload('ReportPinState', 1, {
      user_id: USER_ID,
      failed_count: 5,
      lock_tier: 1,
      locked_until: '2026-11-20T10:05:00.000Z',
      last_failed_at: '2026-11-20T10:00:00.000Z',
      pin_epoch_seen: 1,
    })
    expect(tier1).toBeDefined()

    const tier3 = ReportPinStatePayloadV1.parse({
      user_id: USER_ID,
      failed_count: 15,
      lock_tier: 3,
      locked_until: null,
      last_failed_at: '2026-11-20T10:30:00.000Z',
      pin_epoch_seen: 1,
    })
    expect(tier3.lock_tier).toBe(3)
  })

  it('rejects inconsistent locked_until, out-of-range counters, and unknown keys', () => {
    expect(() =>
      ReportPinStatePayloadV1.parse({
        user_id: USER_ID,
        failed_count: 16,
        lock_tier: 3,
        locked_until: null,
        last_failed_at: '2026-11-20T10:30:00.000Z',
        pin_epoch_seen: 1,
      }),
    ).toThrow()

    expect(() =>
      ReportPinStatePayloadV1.parse({
        user_id: USER_ID,
        failed_count: 5,
        lock_tier: 1,
        locked_until: null,
        last_failed_at: '2026-11-20T10:00:00.000Z',
        pin_epoch_seen: 1,
      }),
    ).toThrow()

    expect(() =>
      ReportPinStatePayloadV1.parse({
        user_id: USER_ID,
        failed_count: 15,
        lock_tier: 3,
        locked_until: '2026-11-20T10:35:00.000Z',
        last_failed_at: '2026-11-20T10:30:00.000Z',
        pin_epoch_seen: 1,
      }),
    ).toThrow()
  })
})
