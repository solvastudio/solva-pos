import { describe, expect, it } from 'vitest'
import {
  applyEpoch,
  createInitialPinState,
  isLocked,
  onFailure,
  onSuccess,
  PIN_TIER1_DURATION_MS,
  PIN_TIER2_DURATION_MS,
  recordAttempt,
  remainingAttempts,
} from './pin-state'

const T0 = Date.parse('2026-11-20T10:00:00.000Z')

describe('pos/session/pin-state (BR-AUT-005, BR-AUT-013)', () => {
  it('enforces 5 -> 5m lock, 10 -> 15m lock, 15 -> permanent reset lock', () => {
    let s = createInitialPinState('u1', 'd1', 1)

    for (let i = 1; i <= 4; i += 1) {
      s = recordAttempt(s, T0, T0)
      s = onFailure(s, T0, T0)
      expect(s.failed_count).toBe(i)
      expect(s.lock_tier).toBe(0)
      expect(remainingAttempts(s)).toBe(5 - i)
    }

    // 5th failure -> tier 1 (5 minutes)
    s = recordAttempt(s, T0, T0)
    s = onFailure(s, T0, T0)
    expect(s.failed_count).toBe(5)
    expect(s.lock_tier).toBe(1)
    expect(isLocked(s, T0 + 1_000, T0 + 1_000)).toEqual({
      locked: true,
      minutesLeft: 5,
      needsReset: false,
    })

    // Cooldown expires after 5m, but failed_count stays 5 (monotonic)
    const after5m = T0 + PIN_TIER1_DURATION_MS + 1_000
    expect(isLocked(s, after5m, after5m).locked).toBe(false)
    expect(s.failed_count).toBe(5)

    // Attempts 6..9 fail without re-locking yet, then 10th -> tier 2 (15m)
    for (let i = 6; i <= 9; i += 1) {
      s = recordAttempt(s, after5m, after5m)
      s = onFailure(s, after5m, after5m)
      expect(s.lock_tier).toBe(0)
    }
    s = recordAttempt(s, after5m, after5m)
    s = onFailure(s, after5m, after5m)
    expect(s.failed_count).toBe(10)
    expect(s.lock_tier).toBe(2)
    expect(isLocked(s, after5m + 60_000, after5m + 60_000)).toEqual({
      locked: true,
      minutesLeft: 14,
      needsReset: false,
    })

    // Rewinding tablet clock backwards never shortens wait because maxSeenMs clamps upwards
    const rewoundTrustedNow = T0 - 3_600_000
    expect(isLocked(s, rewoundTrustedNow, after5m + 60_000)).toEqual({
      locked: true,
      minutesLeft: 14,
      needsReset: false,
    })

    // Advance past 15m -> attempts 11..15 trigger permanent tier 3 lock
    const after15m = after5m + PIN_TIER2_DURATION_MS + 1_000
    for (let i = 11; i <= 14; i += 1) {
      s = recordAttempt(s, after15m, after15m)
      s = onFailure(s, after15m, after15m)
      expect(s.lock_tier).toBe(0)
    }
    s = recordAttempt(s, after15m, after15m)
    s = onFailure(s, after15m, after15m)
    expect(s.failed_count).toBe(15)
    expect(s.lock_tier).toBe(3)
    expect(s.locked_until).toBeNull()
    expect(isLocked(s, after15m + 86_400_000, after15m + 86_400_000)).toEqual({
      locked: true,
      minutesLeft: 0,
      needsReset: true,
    })
  })

  it('clears failures on success or higher credential pin_epoch', () => {
    let s = createInitialPinState('u1', 'd1', 1)
    for (let i = 0; i < 15; i += 1) {
      s = recordAttempt(s, T0, T0)
      s = onFailure(s, T0, T0)
    }
    expect(s.lock_tier).toBe(3)

    const sameEpoch = applyEpoch(s, 1)
    expect(sameEpoch.changed).toBe(false)
    expect(sameEpoch.state.lock_tier).toBe(3)

    const bumped = applyEpoch(s, 2)
    expect(bumped.changed).toBe(true)
    expect(bumped.state).toEqual({
      user_id: 'u1',
      device_id: 'd1',
      failed_count: 0,
      lock_tier: 0,
      locked_until: null,
      last_failed_at: null,
      pin_epoch_seen: 2,
    })

    const cleared = onSuccess(recordAttempt(bumped.state, T0, T0))
    expect(cleared.failed_count).toBe(0)
    expect(cleared.lock_tier).toBe(0)
  })
})
