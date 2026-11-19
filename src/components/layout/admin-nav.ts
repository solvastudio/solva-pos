import type { ComponentType } from 'react'
import { LayoutDashboard, User } from '~/components/ui'
import type { PermissionCode } from '~/modules/identity/shared'

export interface AdminNavItem {
  id: 'dashboard' | 'account'
  path: '' | `/${string}`
  labelKey: 'admin.nav.dashboard' | 'admin.nav.account'
  icon: ComponentType<{ className?: string }>
  requiredPermission?: PermissionCode
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  {
    id: 'dashboard',
    path: '/admin',
    labelKey: 'admin.nav.dashboard',
    icon: LayoutDashboard,
  },
  {
    id: 'account',
    path: '/admin/account',
    labelKey: 'admin.nav.account',
    icon: User,
  },
]

export function visibleAdminNavItems(
  permissions: readonly PermissionCode[],
): readonly AdminNavItem[] {
  const permSet = new Set<PermissionCode>(permissions)
  return ADMIN_NAV_ITEMS.filter(
    (item) => !item.requiredPermission || permSet.has(item.requiredPermission),
  )
}
