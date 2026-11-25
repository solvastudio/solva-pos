import { describe, expect, it } from 'vitest'
import { canAccept, canAddItem, canEditBill, canHandOver, canPay } from './bill-guards'

describe('pos/domain/bill-guards', () => {
  it('evaluates canEditBill across OPEN, CLOSED, READ_ONLY_OTHER, READ_ONLY_PENDING', () => {
    expect(
      canEditBill({ status: 'OPEN', lease_device_id: 'dev-1', handover_status: 'NONE' }, 'dev-1'),
    ).toEqual({ ok: true })
    expect(
      canEditBill({ status: 'PAID', lease_device_id: 'dev-1', handover_status: 'NONE' }, 'dev-1'),
    ).toEqual({ ok: false, reason: 'CLOSED' })
    expect(
      canEditBill({ status: 'OPEN', lease_device_id: 'dev-2', handover_status: 'NONE' }, 'dev-1'),
    ).toEqual({ ok: false, reason: 'READ_ONLY_OTHER' })
    expect(
      canEditBill({ status: 'OPEN', lease_device_id: 'dev-1', handover_status: 'PENDING' }, 'dev-1'),
    ).toEqual({ ok: false, reason: 'READ_ONLY_PENDING' })
  })

  it('distinguishes OFFLINE and EVENTS_PENDING in canHandOver', () => {
    const base = { status: 'OPEN', lease_device_id: 'dev-1', handover_status: 'NONE' } as const
    expect(
      canHandOver(base, {
        deviceId: 'dev-1',
        isOnline: false,
        pendingOutboxCount: 0,
        hasOtherActiveCashier: true,
      }),
    ).toEqual({ ok: false, reason: 'OFFLINE' })
    expect(
      canHandOver(base, {
        deviceId: 'dev-1',
        isOnline: true,
        pendingOutboxCount: 2,
        hasOtherActiveCashier: true,
      }),
    ).toEqual({ ok: false, reason: 'EVENTS_PENDING' })
    expect(
      canHandOver(base, {
        deviceId: 'dev-1',
        isOnline: true,
        pendingOutboxCount: 0,
        hasOtherActiveCashier: true,
      }),
    ).toEqual({ ok: true })
  })

  it('enforces CASHIER + shift + lease rules for canAccept and canPay and blocks unavailable items', () => {
    expect(
      canAccept(
        { status: 'OPEN', handover_status: 'PENDING', handover_target_register_id: 'cas-1' },
        { registerId: 'cas-1', registerType: 'CASHIER', isOnline: true },
      ),
    ).toBe(true)
    expect(
      canAccept(
        { status: 'OPEN', handover_status: 'PENDING', handover_target_register_id: 'cas-1' },
        { registerId: 'cas-1', registerType: 'WAITER', isOnline: true },
      ),
    ).toBe(false)

    expect(
      canPay(
        {
          status: 'OPEN',
          lease_device_id: 'dev-1',
          lease_register_id: 'cas-1',
          handover_status: 'NONE',
          split_mode: null,
        },
        {
          deviceId: 'dev-1',
          registerId: 'cas-1',
          registerType: 'CASHIER',
          hasOpenShift: true,
          activeItemCount: 1,
        },
      ),
    ).toBe(true)
    expect(
      canPay(
        {
          status: 'OPEN',
          lease_device_id: 'dev-1',
          lease_register_id: 'wtr-1',
          handover_status: 'NONE',
          split_mode: null,
        },
        {
          deviceId: 'dev-1',
          registerId: 'wtr-1',
          registerType: 'WAITER',
          hasOpenShift: false,
          activeItemCount: 1,
        },
      ),
    ).toBe(false)

    expect(canAddItem(false)).toEqual({
      ok: false,
      reason: 'ITEM_UNAVAILABLE',
      messageKey: 'pos.bill.itemUnavailable',
    })
  })
})
