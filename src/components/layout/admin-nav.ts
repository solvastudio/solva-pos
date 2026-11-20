import type { ComponentType } from 'react'
import {
  Layers,
  LayoutDashboard,
  Package,
  Settings,
  ShieldAlert,
  Store,
  Tag,
  User,
  Users,
} from '~/components/ui/icons'
import type { PermissionCode } from '~/modules/identity/shared'

export interface AdminNavItem {
  id:
    | 'dashboard'
    | 'catalog'
    | 'prices'
    | 'availability'
    | 'features'
    | 'attention'
    | 'settings'
    | 'users'
    | 'account'
  path: '' | `/${string}`
  labelKey:
    | 'admin.nav.dashboard'
    | 'admin.nav.catalog'
    | 'admin.nav.prices'
    | 'admin.nav.availability'
    | 'admin.nav.features'
    | 'admin.nav.attention'
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
    id: 'catalog',
    path: '/admin/catalog',
    labelKey: 'admin.nav.catalog',
    icon: Package,
    requiredPermission: 'catalog.manage',
    phase: 'F2',
  },
  {
    id: 'prices',
    path: '/admin/prices',
    labelKey: 'admin.nav.prices',
    icon: Tag,
    requiredPermission: 'catalog.manage',
    phase: 'F2',
  },
  {
    id: 'availability',
    path: '/admin/availability',
    labelKey: 'admin.nav.availability',
    icon: Store,
    requiredPermission: 'catalog.manage',
    phase: 'F2',
  },
  {
    id: 'features',
    path: '/admin/features',
    labelKey: 'admin.nav.features',
    icon: Layers,
    requiredPermission: 'flag.manage',
    phase: 'F2',
  },
  {
    id: 'attention',
    path: '/admin/attention',
    labelKey: 'admin.nav.attention',
    icon: ShieldAlert,
    requiredPermission: 'audit.view',
    phase: 'F3',
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
