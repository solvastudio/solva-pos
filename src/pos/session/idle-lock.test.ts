import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIdleLockController, IDLE_LOCK_TIMEOUT_MS } from './idle-lock'

describe('pos/session/idle-lock (BR-AUT-015, FLOW-20)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('locks after 10m of monotonic inactivity, pauses during payment/dialogs, and ignores Date wall-clock jumps', () => {
    vi.useFakeTimers()
    let perfMs = 1_000
    let paused = false
    let active = true
    const onLock = vi.fn()

    const ctrl = createIdleLockController({
      timeoutMs: IDLE_LOCK_TIMEOUT_MS,
      checkIntervalMs: 15_000,
      perfNow: () => perfMs,
      isPaused: () => paused,
      isActive: () => active,
      onLock,
    })

    // Advance 9 minutes -> not locked
    perfMs += 9 * 60 * 1000
    ctrl.tick()
    expect(onLock).not.toHaveBeenCalled()

    // Wall-clock Date jumps forward 5 hours, but perfMs stays at 9m -> NOT locked
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    ctrl.tick()
    expect(onLock).not.toHaveBeenCalled()

    // Pause for 15 minutes during payment -> budget does not drain
    paused = true
    perfMs += 15 * 60 * 1000
    ctrl.tick()
    expect(onLock).not.toHaveBeenCalled()
    expect(ctrl.remainingMs()).toBe(60_000)

    // Unpause, activity resets timer back to 10m
    paused = false
    ctrl.markActivity()
    expect(ctrl.remainingMs()).toBe(IDLE_LOCK_TIMEOUT_MS)

    // Advance full 10m -> triggers lock once
    perfMs += IDLE_LOCK_TIMEOUT_MS
    ctrl.tick()
    expect(onLock).toHaveBeenCalledTimes(1)

    active = false
    ctrl.stop()
  })
})
