export const PERMISSION_CODES = [
  'sale.create',
  'sale.void',
  'return.approve',
  'discount.manual',
  'discount.approve',
  'drawer.open',
  'bill.edit',
  'bill.void_item',
  'bill.handover',
  'bill.accept',
  'shift.open_close',
  'cash.in_out',
  'shift.view_variance',
  'shift.force_close',
  'gap.annotate',
  'catalog.manage',
  'inventory.manage',
  'user.manage',
  'role.manage',
  'user.invite',
  'user.remove',
  'user.reset_password',
  'flag.manage',
  'screen.unlock_override',
  'customer.view_phone',
  'report.view',
  'audit.view',
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]

export type PermissionModule =
  | 'sales'
  | 'fnb'
  | 'shift'
  | 'catalog'
  | 'inventory'
  | 'identity'
  | 'reporting'
  | 'audit'

export interface PermissionMeta {
  code: PermissionCode
  module: PermissionModule
  description: string
}

export const PERMISSION_DEFINITIONS: readonly PermissionMeta[] = [
  { code: 'sale.create', module: 'sales', description: 'permission.sale.create' },
  { code: 'sale.void', module: 'sales', description: 'permission.sale.void' },
  { code: 'return.approve', module: 'sales', description: 'permission.return.approve' },
  { code: 'discount.manual', module: 'sales', description: 'permission.discount.manual' },
  { code: 'discount.approve', module: 'sales', description: 'permission.discount.approve' },
  { code: 'drawer.open', module: 'sales', description: 'permission.drawer.open' },
  { code: 'bill.edit', module: 'fnb', description: 'permission.bill.edit' },
  { code: 'bill.void_item', module: 'fnb', description: 'permission.bill.void_item' },
  { code: 'bill.handover', module: 'fnb', description: 'permission.bill.handover' },
  { code: 'bill.accept', module: 'fnb', description: 'permission.bill.accept' },
  { code: 'shift.open_close', module: 'shift', description: 'permission.shift.open_close' },
  { code: 'cash.in_out', module: 'shift', description: 'permission.cash.in_out' },
  { code: 'shift.view_variance', module: 'shift', description: 'permission.shift.view_variance' },
  { code: 'shift.force_close', module: 'shift', description: 'permission.shift.force_close' },
  { code: 'gap.annotate', module: 'shift', description: 'permission.gap.annotate' },
  { code: 'catalog.manage', module: 'catalog', description: 'permission.catalog.manage' },
  { code: 'inventory.manage', module: 'inventory', description: 'permission.inventory.manage' },
  { code: 'user.manage', module: 'identity', description: 'permission.user.manage' },
  { code: 'role.manage', module: 'identity', description: 'permission.role.manage' },
  { code: 'user.invite', module: 'identity', description: 'permission.user.invite' },
  { code: 'user.remove', module: 'identity', description: 'permission.user.remove' },
  { code: 'user.reset_password', module: 'identity', description: 'permission.user.reset_password' },
  { code: 'flag.manage', module: 'identity', description: 'permission.flag.manage' },
  {
    code: 'screen.unlock_override',
    module: 'identity',
    description: 'permission.screen.unlock_override',
  },
  { code: 'customer.view_phone', module: 'identity', description: 'permission.customer.view_phone' },
  { code: 'report.view', module: 'reporting', description: 'permission.report.view' },
  { code: 'audit.view', module: 'audit', description: 'permission.audit.view' },
] as const

const PERMISSION_SET = new Set<string>(PERMISSION_CODES)

export function isPermissionCode(value: string): value is PermissionCode {
  return PERMISSION_SET.has(value)
}
