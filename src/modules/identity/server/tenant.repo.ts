import '@tanstack/react-start/server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { NoTenantTx, TenantTx } from '~/server/db'
import { ROLE_DEFAULTS } from '../domain/default-roles'
import { organization, session } from './auth-schema'
import {
  appUser,
  paymentMethod,
  role,
  rolePermission,
  tenant,
  userOutlet,
} from './schema'

export type TenantLifecycleStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED'

export interface PlatformTenantSummaryRow {
  id: string
  name: string
  slug: string
  status: TenantLifecycleStatus
  createdAt: string
}

export interface TenantDetailRow {
  id: string
  name: string
  slug: string
  status: TenantLifecycleStatus
  authOrgId: string | null
  createdAt: string
}

export interface TenantMemberOverviewRow {
  id: string
  displayName: string
  membershipStatus: string
  isActive: boolean
  hasAuthAccount: boolean
  roleCodes: string[]
}

export async function insertTenantAndSyncRows(
  tx: TenantTx,
  params: { id: string; name: string; slug: string; nowIso: string },
): Promise<void> {
  await tx.insert(tenant).values({
    id: params.id,
    name: params.name,
    slug: params.slug,
    status: 'ACTIVE',
    defaultLocale: 'id-ID',
    currency: 'IDR',
    version: 1,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  })

  await tx.execute(
    sql`INSERT INTO tenant_sync (tenant_id, version, tombstone_floor_version, updated_at)
        VALUES (${params.id}, 0, 0, ${params.nowIso}::timestamptz)`,
  )
}

export async function seedDefaultTenantMasterRows(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    newId: () => string
    ownerAppUserId: string
    ownerDisplayName: string
    nowIso: string
  },
): Promise<{ ownerRoleId: string }> {
  let ownerRoleId = ''
  const roleRows: Array<{
    tenantId: string
    id: string
    code: string
    name: string
    isSystem: boolean
    discountLimitPct: string
    version: number
    createdAt: string
    updatedAt: string
    createdBy: null
    updatedBy: null
  }> = []
  const rolePermRows: Array<{
    tenantId: string
    id: string
    roleId: string
    permissionCode: string
    version: number
    createdAt: string
    updatedAt: string
    createdBy: null
    updatedBy: null
  }> = []

  for (const def of ROLE_DEFAULTS) {
    const roleId = params.newId()
    if (def.code === 'OWNER') {
      ownerRoleId = roleId
    }
    roleRows.push({
      tenantId: writer.tenantId,
      id: roleId,
      code: def.code,
      name: def.name,
      isSystem: true,
      discountLimitPct: def.discountLimitPct,
      version: writer.version,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: null,
      updatedBy: null,
    })
    for (const perm of def.permissions) {
      rolePermRows.push({
        tenantId: writer.tenantId,
        id: params.newId(),
        roleId,
        permissionCode: perm,
        version: writer.version,
        createdAt: params.nowIso,
        updatedAt: params.nowIso,
        createdBy: null,
        updatedBy: null,
      })
    }
  }

  await tx.insert(role).values(roleRows)
  await tx.insert(rolePermission).values(rolePermRows)

  await tx.insert(paymentMethod).values({
    tenantId: writer.tenantId,
    id: params.newId(),
    code: 'CASH',
    name: 'Tunai',
    kind: 'CASH',
    requiresReference: false,
    sortOrder: 0,
    isActive: true,
    version: writer.version,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    createdBy: null,
    updatedBy: null,
  })

  await tx.insert(appUser).values({
    tenantId: writer.tenantId,
    id: params.ownerAppUserId,
    authUserId: null,
    displayName: params.ownerDisplayName,
    isActive: true,
    membershipStatus: 'PENDING',
    version: writer.version,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    createdBy: null,
    updatedBy: null,
  })

  await tx.insert(userOutlet).values({
    tenantId: writer.tenantId,
    id: params.newId(),
    userId: params.ownerAppUserId,
    outletId: null,
    roleId: ownerRoleId,
    version: writer.version,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    createdBy: null,
    updatedBy: null,
  })

  return { ownerRoleId }
}

export async function insertOrganizationAndLinkTenant(
  tx: TenantTx,
  params: { tenantId: string; orgId: string; name: string; slug: string; now: Date },
): Promise<void> {
  await tx.insert(organization).values({
    id: params.orgId,
    name: params.name,
    slug: params.slug,
    createdAt: params.now,
  })

  await tx
    .update(tenant)
    .set({ authOrgId: params.orgId })
    .where(eq(tenant.id, params.tenantId))
}

export async function findTenantDetailRow(
  tx: TenantTx,
  tenantId: string,
): Promise<TenantDetailRow | null> {
  const rows = await tx
    .select({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      authOrgId: tenant.authOrgId,
      createdAt: tenant.createdAt,
    })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    id: String(row.id).toLowerCase(),
    name: row.name,
    slug: row.slug,
    status: row.status as TenantLifecycleStatus,
    authOrgId: row.authOrgId,
    createdAt: row.createdAt,
  }
}

export async function updateTenantStatusRow(
  tx: TenantTx,
  writer: MasterWriter,
  nextStatus: TenantLifecycleStatus,
  nowIso: string,
): Promise<void> {
  await tx
    .update(tenant)
    .set({
      status: nextStatus,
      version: writer.version,
      updatedAt: nowIso,
    })
    .where(eq(tenant.id, writer.tenantId))
}

export async function updateTenantNameRow(
  tx: TenantTx,
  writer: MasterWriter,
  nextName: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(tenant)
    .set({
      name: nextName,
      version: writer.version,
      updatedAt: nowIso,
    })
    .where(eq(tenant.id, writer.tenantId))
}

export async function deleteAllOrgSessions(tx: TenantTx, authOrgId: string): Promise<void> {
  await tx.delete(session).where(eq(session.activeOrganizationId, authOrgId))
}

export async function listTenantsViaDefiner(
  tx: NoTenantTx,
): Promise<PlatformTenantSummaryRow[]> {
  const res = await tx.execute(
    sql`SELECT id, name, slug, status, created_at FROM list_tenants_for_platform()`,
  )
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>
    const createdAtRaw = row.created_at
    const createdAt =
      createdAtRaw instanceof Date ? createdAtRaw.toISOString() : String(createdAtRaw)
    return {
      id: String(row.id).toLowerCase(),
      name: String(row.name),
      slug: String(row.slug),
      status: String(row.status) as TenantLifecycleStatus,
      createdAt,
    }
  })
}

export async function listTenantMembersOverview(
  tx: TenantTx,
  tenantId: string,
): Promise<TenantMemberOverviewRow[]> {
  const users = await tx
    .select({
      id: appUser.id,
      displayName: appUser.displayName,
      membershipStatus: appUser.membershipStatus,
      isActive: appUser.isActive,
      authUserId: appUser.authUserId,
    })
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), isNull(appUser.deletedAt)))

  const roleBindings = await tx
    .select({
      userId: userOutlet.userId,
      roleCode: role.code,
    })
    .from(userOutlet)
    .innerJoin(
      role,
      and(eq(role.tenantId, userOutlet.tenantId), eq(role.id, userOutlet.roleId), isNull(role.deletedAt)),
    )
    .where(and(eq(userOutlet.tenantId, tenantId), isNull(userOutlet.deletedAt)))

  const roleMap = new Map<string, Set<string>>()
  for (const rb of roleBindings) {
    const uid = String(rb.userId).toLowerCase()
    let set = roleMap.get(uid)
    if (!set) {
      set = new Set<string>()
      roleMap.set(uid, set)
    }
    set.add(rb.roleCode)
  }

  return users.map((u) => {
    const uid = String(u.id).toLowerCase()
    return {
      id: uid,
      displayName: u.displayName,
      membershipStatus: u.membershipStatus,
      isActive: u.isActive,
      hasAuthAccount: Boolean(u.authUserId),
      roleCodes: [...(roleMap.get(uid) ?? [])].sort(),
    }
  })
}
