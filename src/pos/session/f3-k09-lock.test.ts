import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIdleLockController, IDLE_LOCK_TIMEOUT_MS } from './idle-lock'

/**
 * F3-K09: kunci layar otomatis 10 menit. Keranjang tetap utuh (controller hanya memicu kunci),
 * timer berhenti saat pembayaran atau dialog PIN supervisor terbuka, dan aktivitas mereset hitungan.
 */
describe('F3-K09 kunci layar otomatis 10 menit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('mengunci setelah 10 menit idle; berhenti saat pembayaran/dialog supervisor; reset oleh aktivitas', () => {
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

    // 9 menit idle: belum terkunci.
    perfMs += 9 * 60_000
    ctrl.tick()
    expect(onLock).not.toHaveBeenCalled()

    // Dialog bayar/PIN supervisor terbuka selama 30 menit: hitungan tidak berkurang.
    paused = true
    perfMs += 30 * 60_000
    ctrl.tick()
    expect(onLock).not.toHaveBeenCalled()
    expect(ctrl.remainingMs()).toBe(60_000)

    // Dialog ditutup, lalu ada aktivitas: hitungan kembali penuh.
    paused = false
    ctrl.markActivity()
    expect(ctrl.remainingMs()).toBe(IDLE_LOCK_TIMEOUT_MS)

    // 10 menit idle sejak aktivitas terakhir: terkunci sekali.
    perfMs += IDLE_LOCK_TIMEOUT_MS
    ctrl.tick()
    ctrl.tick()
    expect(onLock).toHaveBeenCalledTimes(1)

    ctrl.stop()
  })
})
