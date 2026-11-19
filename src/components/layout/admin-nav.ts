import type { ComponentType } from 'react'
import { LayoutDashboard, Settings, User, Users } from '~/components/ui'
import type { PermissionCode } from '~/modules/identity/shared'

export interface AdminNavItem {
  id: 'dashboard' | 'settings' | 'users' | 'account'
  path: '' | `/${string}`
  labelKey:
    | 'admin.nav.dashboard'
    | 'admin.nav.settings'
    | 'admin.nav.users'
    | 'admin.nav.account'
  icon: ComponentType<{ className?: string }>
  requiredPermission?: PermissionCode
  phase?: 'F1' | 'F2' | 'F3'
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  {
    id: 'dashboard',
    path: '/admin',
    labelKey: 'admin.nav.dashboard',
    icon: LayoutDashboard,
    phase: 'F1',
  },
  {
    id: 'settings',
    path: '/admin/settings',
    labelKey: 'admin.nav.settings',
    icon: Settings,
    requiredPermission: 'user.manage',
    phase: 'F1',
  },
  {
    id: 'users',
    path: '/admin/users',
    labelKey: 'admin.nav.users',
    icon: Users,
    requiredPermission: 'user.manage',
    phase: 'F1',
  },
  {
    id: 'account',
    path: '/admin/account',
    labelKey: 'admin.nav.account',
    icon: User,
    phase: 'F1',
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
