import type { PermissionCode } from '~/modules/identity/shared'

export const POS_ACTION_PERMISSIONS = {
  createSale: 'sale.create',
  voidSale: 'sale.void',
  approveReturn: 'return.approve',
  applyManualDiscount: 'discount.manual',
  approveDiscount: 'discount.approve',
  openDrawer: 'drawer.open',
  editBill: 'bill.edit',
  voidBillItem: 'bill.void_item',
  handoverBill: 'bill.handover',
  acceptBill: 'bill.accept',
  openCloseShift: 'shift.open_close',
  cashMovement: 'cash.in_out',
  viewShiftVariance: 'shift.view_variance',
  forceCloseShift: 'shift.force_close',
  unlockOverride: 'screen.unlock_override',
  viewCustomerPhone: 'customer.view_phone',
} as const satisfies Record<string, PermissionCode>

export type PosAction = keyof typeof POS_ACTION_PERMISSIONS

export function permissionForAction(action: PosAction): PermissionCode {
  return POS_ACTION_PERMISSIONS[action]
}
