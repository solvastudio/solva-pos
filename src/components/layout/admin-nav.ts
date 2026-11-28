import type { ComponentType } from 'react'
import {
  Banknote,
  CircleAlert,
  Layers,
  LayoutDashboard,
  Package,
  Settings,
  ShieldAlert,
  Store,
  Tag,
  User,
  Users,
  Utensils,
} from '~/components/ui/icons'
import type { PermissionCode } from '~/modules/identity/shared'

export interface AdminNavItem {
  id:
    | 'dashboard'
    | 'reportSales'
    | 'reportShifts'
    | 'reportOperations'
    | 'catalog'
    | 'prices'
    | 'availability'
    | 'tables'
    | 'stock'
    | 'features'
    | 'attention'
    | 'settings'
    | 'users'
    | 'account'
  path: '' | `/${string}`
  labelKey:
    | 'admin.nav.dashboard'
    | 'admin.nav.reportSales'
    | 'admin.nav.reportShifts'
    | 'admin.nav.reportOperations'
    | 'admin.nav.catalog'
    | 'admin.nav.prices'
    | 'admin.nav.availability'
    | 'admin.nav.tables'
    | 'admin.nav.stock'
    | 'admin.nav.features'
    | 'admin.nav.attention'
    | 'admin.nav.settings'
    | 'admin.nav.users'
    | 'admin.nav.account'
  icon: ComponentType<{ className?: string }>
  requiredPermission?: PermissionCode
  /** Visible when the user holds at least one of these permissions. */
  requiredAnyPermission?: readonly PermissionCode[]
  phase?: 'F1' | 'F2' | 'F3' | 'F4' | 'F5'
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
    id: 'reportSales',
    path: '/admin/reports/sales',
    labelKey: 'admin.nav.reportSales',
    icon: Banknote,
    requiredPermission: 'report.view',
    phase: 'F3',
  },
  {
    id: 'reportShifts',
    path: '/admin/reports/shifts',
    labelKey: 'admin.nav.reportShifts',
    icon: Store,
    requiredPermission: 'report.view',
    phase: 'F3',
  },
  {
    id: 'reportOperations',
    path: '/admin/reports/operations',
    labelKey: 'admin.nav.reportOperations',
    icon: CircleAlert,
    requiredPermission: 'report.view',
    phase: 'F3',
  },
  {
    id: 'catalog',
    path: '/admin/catalog',
    labelKey: 'admin.nav.catalog',
    icon: Package,
    requiredAnyPermission: ['catalog.view', 'catalog.manage'],
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
    id: 'tables',
    path: '/admin/tables',
    labelKey: 'admin.nav.tables',
    icon: Utensils,
    requiredPermission: 'catalog.manage',
    phase: 'F5',
  },
  {
    id: 'stock',
    path: '/admin/stock',
    labelKey: 'admin.nav.stock',
    icon: Package,
    requiredPermission: 'report.view',
    phase: 'F4',
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
    requiredPermission: 'org.manage',
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
    (item) =>
      (!item.requiredPermission || permSet.has(item.requiredPermission)) &&
      (!item.requiredAnyPermission || item.requiredAnyPermission.some((p) => permSet.has(p))),
  )
}
