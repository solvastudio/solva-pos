import { describe, expect, it, vi } from 'vitest'
import { createSyncClock } from './clock'

describe('pos/sync/clock', () => {
  it('computes Cristian offset, picks smallest RTT across 5 samples, ignores RTT > 5s, and computes BR-TIM-005 businessDate', async () => {
    const wall = Date.UTC(2026, 10, 20, 17, 2, 0) // Device fast by +7 min (17:02 UTC = 00:02 WIB)
    const mono = 1_000
    const clk = createSyncClock({
      nowMs: () => wall,
      perfNow: () => mono,
    })

    // Server time is 16:55:00 UTC (23:55 WIB on Nov 20!) -> true offset = -7 min (-420_000ms)
    const serverTime = Date.UTC(2026, 10, 20, 16, 55, 0)

    // Sample with RTT > 5000ms MUST be ignored.
    expect(
      await clk.recordSample({ tSendDeviceMs: wall, rttMs: 5_001, serverTimeMs: serverTime }),
    ).toBe(false)
    expect(clk.getOffsetMs()).toBe(0)

    // Sample 1: RTT 400ms
    expect(
      await clk.recordSample({
        tSendDeviceMs: wall,
        rttMs: 400,
        serverTimeMs: serverTime + 200,
      }),
    ).toBe(true)
    expect(clk.getOffsetMs()).toBe(-420_000)

    // Sample 2 with worse RTT 1000ms should NOT replace lower-RTT sample 1!
    await clk.recordSample({
      tSendDeviceMs: wall,
      rttMs: 1_000,
      serverTimeMs: serverTime - 50_000,
    })
    expect(clk.getOffsetMs()).toBe(-420_000)

    // Business date in WIB (Asia/Jakarta, UTC+7) must be 2026-11-20 (23:55 WIB), NOT 2026-11-21!
    expect(clk.trustedBusinessDate('Asia/Jakarta', '00:00')).toBe('2026-11-20')

    // Monotonic maxSeen check
    clk.bumpMaxSeen(serverTime + 10_000)
    expect(clk.getMaxSeenMs()).toBe(serverTime + 10_000)
    clk.bumpMaxSeen(serverTime - 10_000)
    expect(clk.getMaxSeenMs()).toBe(serverTime + 10_000)
  })

  it('detects session clock tampering via monotonic anchor and fires onClockAnomaly once', () => {
    let wall = 1_000_000
    let mono = 10_000
    const onClockAnomaly = vi.fn()
    const clk = createSyncClock({
      nowMs: () => wall,
      perfNow: () => mono,
      onClockAnomaly,
    })

    // User sets system clock backwards by 15 minutes while monotonic clock only advanced 1s.
    wall -= 15 * 60_000
    mono += 1_000
    expect(clk.trustedNow()).toBe(1_001_000)
    expect(onClockAnomaly).toHaveBeenCalledTimes(1)
  })
})
