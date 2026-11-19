import { PERMISSION_CODES, type PermissionCode } from './permissions'

export interface RoleDefault {
  code: string
  name: string
  discountLimitPct: string
  permissions: readonly PermissionCode[]
}

export const ROLE_DEFAULTS: readonly RoleDefault[] = [
  {
    code: 'OWNER',
    name: 'Owner',
    discountLimitPct: '100.0000',
    permissions: [...PERMISSION_CODES],
  },
  {
    code: 'MANAGER',
    name: 'Manager',
    discountLimitPct: '50.0000',
    permissions: [
      'sale.create',
      'bill.edit',
      'bill.void_item',
      'bill.handover',
      'bill.accept',
      'screen.unlock_override',
      'discount.manual',
      'discount.approve',
      'sale.void',
      'return.approve',
      'shift.open_close',
      'cash.in_out',
      'drawer.open',
      'shift.view_variance',
      'shift.force_close',
      'gap.annotate',
      'catalog.manage',
      'inventory.manage',
      'user.manage',
      'report.view',
      'audit.view',
      'customer.view_phone',
    ],
  },
  {
    code: 'SUPERVISOR',
    name: 'Supervisor',
    discountLimitPct: '20.0000',
    permissions: [
      'sale.create',
      'bill.edit',
      'bill.void_item',
      'bill.handover',
      'bill.accept',
      'screen.unlock_override',
      'discount.manual',
      'discount.approve',
      'sale.void',
      'return.approve',
      'shift.open_close',
      'cash.in_out',
      'drawer.open',
      'shift.view_variance',
    ],
  },
  {
    code: 'CASHIER',
    name: 'Cashier',
    discountLimitPct: '5.0000',
    permissions: [
      'sale.create',
      'bill.edit',
      'bill.void_item',
      'bill.accept',
      'discount.manual',
      'shift.open_close',
      'cash.in_out',
      'drawer.open',
    ],
  },
  {
    code: 'WAITER',
    name: 'Waiter',
    discountLimitPct: '0.0000',
    permissions: ['bill.edit', 'bill.void_item', 'bill.handover'],
  },
  {
    code: 'WAREHOUSE',
    name: 'Warehouse Staff',
    discountLimitPct: '0.0000',
    permissions: ['inventory.manage', 'report.view'],
  },
  {
    code: 'ACCOUNTANT',
    name: 'Accountant',
    discountLimitPct: '0.0000',
    permissions: ['shift.view_variance', 'report.view', 'audit.view'],
  },
] as const
