import { describe, expect, it, vi } from 'vitest'
import { isSafeMoment, UpdateManager } from './update-manager'

describe('pwa/update-manager', () => {
  it('evaluates all 16 combinations of isSafeMoment accurately', () => {
    const booleans = [false, true]
    const queueCounts = [0, 2]
    let totalChecked = 0

    for (const cartActive of booleans) {
      for (const paymentActive of booleans) {
        for (const shiftOpen of booleans) {
          for (const queueNonAcked of queueCounts) {
            totalChecked += 1
            const expected = !cartActive && !paymentActive && !shiftOpen && queueNonAcked === 0
            expect(
              isSafeMoment({ cartActive, paymentActive, shiftOpen, queueNonAcked }),
            ).toBe(expected)
          }
        }
      }
    }

    expect(totalChecked).toBe(16)
  })

  it('transitions none -> available -> pending_apply -> applying and reloads once on controllerchange', () => {
    const sendSkipWaiting = vi.fn()
    const reloadPage = vi.fn()
    const mgr = new UpdateManager({ sendSkipWaiting, reloadPage })
    const seen: string[] = []
    mgr.subscribe((s) => seen.push(s))

    expect(mgr.getStatus()).toBe('none')
    expect(mgr.applyUpdate()).toBe(false)

    mgr.markAvailable()
    expect(mgr.getStatus()).toBe('available')

    mgr.markPendingApply()
    expect(mgr.getStatus()).toBe('pending_apply')

    expect(mgr.applyUpdate()).toBe(true)
    expect(mgr.getStatus()).toBe('applying')
    expect(sendSkipWaiting).toHaveBeenCalledTimes(1)
    expect(reloadPage).not.toHaveBeenCalled()

    expect(mgr.handleControllerChange()).toBe(true)
    expect(mgr.handleControllerChange()).toBe(false)
    expect(reloadPage).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['available', 'pending_apply', 'applying'])
  })
})
