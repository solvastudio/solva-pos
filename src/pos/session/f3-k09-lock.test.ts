import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIdleLockController, IDLE_LOCK_TIMEOUT_MS } from './idle-lock'

/**
 * F3-K09: auto-lock after 10 minutes of inactivity. The cart stays intact (the controller only triggers the lock),
 * the timer stops while a payment or supervisor PIN dialog is open, and activity resets the count.
 */
describe('F3-K09 screen auto-lock after 10 minutes', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('locks after 10 idle minutes; stops during payment or supervisor dialog; reset by activity', () => {
    vi.useFakeTimers()
    let perfMs = 0
    let paused = false
    const active = true
    const onLock = vi.fn()
    const ctrl = createIdleLockController({
      timeoutMs: IDLE_LOCK_TIMEOUT_MS,
      checkIntervalMs: 15_000,
      perfNow: () => perfMs,
      isPaused: () => paused,
      isActive: () => active,
      onLock,
    })

    // 9 minutes idle: not locked yet.
    perfMs += 9 * 60_000
    ctrl.tick()
    expect(onLock).not.toHaveBeenCalled()

    // Payment or supervisor PIN dialog open for 30 minutes: the count does not decrease.
    paused = true
    perfMs += 30 * 60_000
    ctrl.tick()
    expect(onLock).not.toHaveBeenCalled()
    expect(ctrl.remainingMs()).toBe(60_000)

    // Dialog closed, then activity: the count is fully reset.
    paused = false
    ctrl.markActivity()
    expect(ctrl.remainingMs()).toBe(IDLE_LOCK_TIMEOUT_MS)

    // 10 minutes idle since the last activity: locked once.
    perfMs += IDLE_LOCK_TIMEOUT_MS
    ctrl.tick()
    ctrl.tick()
    expect(onLock).toHaveBeenCalledTimes(1)

    ctrl.stop()
  })
})
