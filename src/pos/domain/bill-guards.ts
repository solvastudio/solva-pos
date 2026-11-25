import type { BillRecord, BillSnapshotRecord } from '../db/types'

export type EditBillDeniedReason = 'CLOSED' | 'READ_ONLY_OTHER' | 'READ_ONLY_PENDING'

export type EditBillCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: EditBillDeniedReason }

export type HandoverDeniedReason =
  | EditBillDeniedReason
  | 'OFFLINE'
  | 'EVENTS_PENDING'
  | 'NO_TARGET_REGISTER'

export type HandoverCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: HandoverDeniedReason }

export function canEditBill(
  bill: Pick<BillRecord, 'status' | 'lease_device_id' | 'handover_status'>,
  deviceId: string,
): EditBillCheck {
  if (bill.status !== 'OPEN') {
    return { ok: false, reason: 'CLOSED' }
  }
  if (bill.lease_device_id !== deviceId) {
    return { ok: false, reason: 'READ_ONLY_OTHER' }
  }
  if (bill.handover_status === 'PENDING') {
    return { ok: false, reason: 'READ_ONLY_PENDING' }
  }
  return { ok: true }
}

export function canHandOver(
  bill: Pick<BillRecord, 'status' | 'lease_device_id' | 'handover_status'>,
  ctx: {
    deviceId: string
    isOnline: boolean
    pendingOutboxCount: number
    hasOtherActiveCashier: boolean
  },
): HandoverCheck {
  const edit = canEditBill(bill, ctx.deviceId)
  if (!edit.ok) return edit
  if (!ctx.isOnline) {
    return { ok: false, reason: 'OFFLINE' }
  }
  if (ctx.pendingOutboxCount > 0) {
    return { ok: false, reason: 'EVENTS_PENDING' }
  }
  if (!ctx.hasOtherActiveCashier) {
    return { ok: false, reason: 'NO_TARGET_REGISTER' }
  }
  return { ok: true }
}

export function canAccept(
  bill: Pick<BillSnapshotRecord, 'status' | 'handover_status' | 'handover_target_register_id'>,
  ctx: {
    registerId: string
    registerType: 'CASHIER' | 'WAITER'
    isOnline: boolean
  },
): boolean {
  return (
    bill.status === 'OPEN' &&
    bill.handover_status === 'PENDING' &&
    bill.handover_target_register_id === ctx.registerId &&
    ctx.isOnline &&
    ctx.registerType === 'CASHIER'
  )
}

export function canPay(
  bill: Pick<BillRecord, 'status' | 'lease_device_id' | 'lease_register_id' | 'handover_status' | 'split_mode'>,
  ctx: {
    deviceId: string
    registerId: string
    registerType: 'CASHIER' | 'WAITER'
    hasOpenShift: boolean
    activeItemCount: number
  },
): boolean {
  if (bill.status !== 'OPEN') return false
  if (bill.lease_device_id !== ctx.deviceId) return false
  if (bill.lease_register_id !== ctx.registerId) return false
  if (bill.handover_status !== 'NONE') return false
  if (ctx.registerType !== 'CASHIER') return false
  if (!ctx.hasOpenShift) return false
  if (bill.split_mode !== 'EQUAL' && ctx.activeItemCount <= 0) return false
  return true
}

export function canAddItem(
  isAvailable: boolean,
): { readonly ok: true } | { readonly ok: false; readonly reason: 'ITEM_UNAVAILABLE'; readonly messageKey: 'pos.bill.itemUnavailable' } {
  if (!isAvailable) {
    return { ok: false, reason: 'ITEM_UNAVAILABLE', messageKey: 'pos.bill.itemUnavailable' }
  }
  return { ok: true }
}
