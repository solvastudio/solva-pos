import '@tanstack/react-start/server-only'
import { isLocale, type Locale } from '~/i18n/resolve-locale'
import { writeMaster } from '~/modules/sync/public'
import { withNoTenant, withTenantReadOnly, withTenant } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { isPermissionCode, type PermissionCode } from '../domain/permissions'
import {
  findAppUserByAuthUserId,
  findMemberByOrgAndUser,
  findTenantAuthMetaById,
  listMembershipBindings,
  listPermissionsForRoles,
  revokeAllUserSessions,
  revokeTenantUserSessions,
  updateAppUserPreferredLocaleRow,
} from './membership.repo'
import { callResolveTenantBySlug } from './tenant-resolver.repo'

export interface TenantAuthMetadata {
  tenantId: string
  slug: string
  status: string
  authOrgId: string
  defaultLocale: Locale
}

export interface LoadedMembership {
  tenantId: string
  tenantSlug: string
  authOrgId: string
  authUserId: string
  appUserId: string
  displayName: string
  preferredLocale: Locale | null
  tenantDefaultLocale: Locale
  effectiveLocale: Locale
  roleCodes: readonly string[]
  permissions: readonly PermissionCode[]
  outletIds: readonly string[] | null
  discountLimitPct: number
}

export async function getTenantAuthMetadataBySlug(
  slug: string,
): Promise<TenantAuthMetadata | null> {
  const resolved = await withNoTenant((tx) =>
    callResolveTenantBySlug(tx, slug.trim().toLowerCase()),
  )
  if (!resolved) {
    return null
  }
  return getTenantAuthMetadataById(resolved.id)
}

export async function getTenantAuthMetadataById(
  tenantId: string,
): Promise<TenantAuthMetadata | null> {
  const row = await withTenantReadOnly(tenantId, (tx) => findTenantAuthMetaById(tx, tenantId))
  if (!row || !row.authOrgId) {
    return null
  }
  return {
    tenantId: row.tenantId,
    slug: row.slug,
    status: row.status,
    authOrgId: row.authOrgId,
    defaultLocale: isLocale(row.defaultLocale) ? row.defaultLocale : 'id-ID',
  }
}

/**
 * Verifies active global org membership AND active tenant `app_user` status before
 * issuing or accepting a tenant-scoped session.
 */
export async function checkActiveMembership(
  tenantId: string,
  authOrgId: string,
  authUserId: string,
): Promise<boolean> {
  const orgMember = await withNoTenant((tx) =>
    findMemberByOrgAndUser(tx, authOrgId, authUserId),
  )
  if (!orgMember) {
    return false
  }

  return withTenantReadOnly(tenantId, async (tx) => {
    const user = await findAppUserByAuthUserId(tx, tenantId, authUserId)
    if (!user) return false
    return user.isActive && user.membershipStatus === 'ACTIVE'
  })
}

/**
 * Loads full RBAC and outlet scope for an authenticated Better Auth user in a specific tenant.
 * Returns null if the tenant is suspended, org membership was removed, or app_user is inactive.
 */
export async function loadMembership(
  tenantId: string,
  authUserId: string,
): Promise<LoadedMembership | null> {
  const meta = await getTenantAuthMetadataById(tenantId)
  if (!meta || meta.status !== 'ACTIVE') {
    return null
  }

  const orgMember = await withNoTenant((tx) =>
    findMemberByOrgAndUser(tx, meta.authOrgId, authUserId),
  )
  if (!orgMember) {
    return null
  }

  return withTenantReadOnly(tenantId, async (tx) => {
    const user = await findAppUserByAuthUserId(tx, tenantId, authUserId)
    if (!user || !user.isActive || user.membershipStatus !== 'ACTIVE') {
      return null
    }

    const bindings = await listMembershipBindings(tx, tenantId, user.id)
    const roleIdSet = new Set<string>()
    const roleCodeSet = new Set<string>()
    const outletSet = new Set<string>()
    let hasAllOutlets = false
    let maxDiscount = 0

    for (const binding of bindings) {
      roleIdSet.add(binding.roleId)
      roleCodeSet.add(binding.roleCode)
      if (binding.outletId === null) {
        hasAllOutlets = true
      } else {
        outletSet.add(binding.outletId)
      }
      const parsedDiscount = Number(binding.discountLimitPct)
      if (Number.isFinite(parsedDiscount) && parsedDiscount > maxDiscount) {
        maxDiscount = parsedDiscount
      }
    }

    const rawPerms = await listPermissionsForRoles(tx, tenantId, [...roleIdSet])
    const permSet = new Set<PermissionCode>()
    for (const code of rawPerms) {
      if (isPermissionCode(code)) {
        permSet.add(code)
      }
    }

    const preferredLocale: Locale | null =
      user.preferredLocale && isLocale(user.preferredLocale) ? user.preferredLocale : null

    return {
      tenantId: meta.tenantId,
      tenantSlug: meta.slug,
      authOrgId: meta.authOrgId,
      authUserId,
      appUserId: user.id,
      displayName: user.displayName,
      preferredLocale,
      tenantDefaultLocale: meta.defaultLocale,
      effectiveLocale: preferredLocale ?? meta.defaultLocale,
      roleCodes: [...roleCodeSet].sort(),
      permissions: [...permSet].sort() as PermissionCode[],
      outletIds: hasAllOutlets ? null : [...outletSet].sort(),
      discountLimitPct: maxDiscount,
    }
  })
}

export async function revokeUserSessionsAcrossAllTenants(authUserId: string): Promise<number> {
  return withNoTenant((tx) => revokeAllUserSessions(tx, authUserId))
}

export async function revokeUserSessionsForTenant(
  tenantId: string,
  authUserId: string,
): Promise<number> {
  const meta = await getTenantAuthMetadataById(tenantId)
  if (!meta) {
    return 0
  }
  return withNoTenant((tx) => revokeTenantUserSessions(tx, meta.authOrgId, authUserId))
}

export async function setAppUserPreferredLocale(
  tenantId: string,
  appUserId: string,
  locale: Locale,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const { result } = await writeMaster(tx, { actorUserId: appUserId }, async (w) => {
      await updateAppUserPreferredLocaleRow(tx, w, appUserId, locale)
      return true
    })
    if (!result) {
      throw new AppError('INTERNAL_ERROR', 'Failed to update preferred locale')
    }
  })
}
