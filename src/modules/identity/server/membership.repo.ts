import '@tanstack/react-start/server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Locale } from '~/i18n/resolve-locale'
import type { MasterWriter } from '~/modules/sync/public'
import type { NoTenantTx, TenantTx } from '~/server/db'
import type { PermissionCode } from '../domain/permissions'
import { member, organization, session } from './auth-schema'
import { appUser, role, rolePermission, tenant, userOutlet } from './schema'

export interface TenantAuthMetaRow {
  tenantId: string
  slug: string
  status: string
  authOrgId: string | null
  defaultLocale: string
}

export interface OrgMemberRow {
  memberId: string
  organizationId: string
  userId: string
  role: string
}

export interface AppUserRow {
  id: string
  authUserId: string | null
  displayName: string
  preferredLocale: string | null
  isActive: boolean
  membershipStatus: string
}

export interface MembershipBindingRow {
  outletId: string | null
  roleId: string
  roleCode: string
  discountLimitPct: string
}

export async function findTenantAuthMetaById(
  tx: TenantTx,
  tenantId: string,
): Promise<TenantAuthMetaRow | null> {
  const rows = await tx
    .select({
      tenantId: tenant.id,
      slug: tenant.slug,
      status: tenant.status,
      authOrgId: tenant.authOrgId,
      defaultLocale: tenant.defaultLocale,
    })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    tenantId: String(row.tenantId).toLowerCase(),
    slug: row.slug,
    status: row.status,
    authOrgId: row.authOrgId,
    defaultLocale: row.defaultLocale,
  }
}

export async function findMemberByOrgAndUser(
  tx: NoTenantTx,
  organizationId: string,
  userId: string,
): Promise<OrgMemberRow | null> {
  const rows = await tx
    .select({
      memberId: member.id,
      organizationId: member.organizationId,
      userId: member.userId,
      role: member.role,
    })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)

  return rows[0] ?? null
}

export async function findOrgBySlug(
  tx: NoTenantTx,
  slug: string,
): Promise<{ id: string; slug: string } | null> {
  const rows = await tx
    .select({ id: organization.id, slug: organization.slug })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1)
  return rows[0] ?? null
}

export async function revokeAllUserSessions(tx: NoTenantTx, userId: string): Promise<number> {
  const deleted = await tx
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id })
  return deleted.length
}

export async function revokeTenantUserSessions(
  tx: NoTenantTx,
  authOrgId: string,
  userId: string,
): Promise<number> {
  const deleted = await tx
    .delete(session)
    .where(and(eq(session.userId, userId), eq(session.activeOrganizationId, authOrgId)))
    .returning({ id: session.id })
  return deleted.length
}

export async function findAppUserByAuthUserId(
  tx: TenantTx,
  tenantId: string,
  authUserId: string,
): Promise<AppUserRow | null> {
  const rows = await tx
    .select({
      id: appUser.id,
      authUserId: appUser.authUserId,
      displayName: appUser.displayName,
      preferredLocale: appUser.preferredLocale,
      isActive: appUser.isActive,
      membershipStatus: appUser.membershipStatus,
    })
    .from(appUser)
    .where(
      and(
        eq(appUser.tenantId, tenantId),
        eq(appUser.authUserId, authUserId),
        isNull(appUser.deletedAt),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    ...row,
    id: String(row.id).toLowerCase(),
  }
}

export async function listMembershipBindings(
  tx: TenantTx,
  tenantId: string,
  appUserId: string,
): Promise<MembershipBindingRow[]> {
  const rows = await tx
    .select({
      outletId: userOutlet.outletId,
      roleId: role.id,
      roleCode: role.code,
      discountLimitPct: role.discountLimitPct,
    })
    .from(userOutlet)
    .innerJoin(
      role,
      and(
        eq(role.tenantId, userOutlet.tenantId),
        eq(role.id, userOutlet.roleId),
        isNull(role.deletedAt),
      ),
    )
    .where(
      and(
        eq(userOutlet.tenantId, tenantId),
        eq(userOutlet.userId, appUserId),
        isNull(userOutlet.deletedAt),
      ),
    )

  return rows.map((row) => ({
    outletId: row.outletId ? String(row.outletId).toLowerCase() : null,
    roleId: String(row.roleId).toLowerCase(),
    roleCode: row.roleCode,
    discountLimitPct: String(row.discountLimitPct),
  }))
}

export async function listPermissionsForRoles(
  tx: TenantTx,
  tenantId: string,
  roleIds: readonly string[],
): Promise<PermissionCode[]> {
  if (roleIds.length === 0) return []
  const rows = await tx
    .select({ permissionCode: rolePermission.permissionCode })
    .from(rolePermission)
    .where(
      and(
        eq(rolePermission.tenantId, tenantId),
        inArray(rolePermission.roleId, [...roleIds]),
        isNull(rolePermission.deletedAt),
      ),
    )

  return rows.map((r) => r.permissionCode as PermissionCode)
}

export async function updateAppUserPreferredLocaleRow(
  tx: TenantTx,
  writer: MasterWriter,
  appUserId: string,
  locale: Locale,
): Promise<void> {
  await tx
    .update(appUser)
    .set({
      preferredLocale: locale,
      version: writer.version,
      updatedAt: new Date().toISOString(),
      updatedBy: writer.actorUserId,
    })
    .where(and(eq(appUser.tenantId, writer.tenantId), eq(appUser.id, appUserId)))
}
