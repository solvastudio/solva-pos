import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { role, rolePermission } from './schema'

export interface RoleDbRow {
  id: string
  code: string
  name: string
  isSystem: boolean
  discountLimitPct: string
  version: number
}

export interface RolePermissionDbRow {
  id: string
  roleId: string
  permissionCode: string
  deletedAt: string | null
}

export async function listRolesRows(tx: TenantTx, tenantId: string): Promise<RoleDbRow[]> {
  return tx
    .select({
      id: role.id,
      code: role.code,
      name: role.name,
      isSystem: role.isSystem,
      discountLimitPct: role.discountLimitPct,
      version: role.version,
    })
    .from(role)
    .where(and(eq(role.tenantId, tenantId), isNull(role.deletedAt)))
    .orderBy(asc(role.createdAt), asc(role.code))
}

export async function listRolePermissionRows(
  tx: TenantTx,
  tenantId: string,
): Promise<RolePermissionDbRow[]> {
  return tx
    .select({
      id: rolePermission.id,
      roleId: rolePermission.roleId,
      permissionCode: rolePermission.permissionCode,
      deletedAt: rolePermission.deletedAt,
    })
    .from(rolePermission)
    .where(and(eq(rolePermission.tenantId, tenantId), isNull(rolePermission.deletedAt)))
    .orderBy(asc(rolePermission.permissionCode))
}

/**
 * Reads an active role and locks its row; call only inside a read-write transaction.
 * `NO KEY UPDATE` still serializes concurrent role edits but does not conflict with the `KEY SHARE`
 * lock that `user_outlet` inserts take through their FK, which would otherwise deadlock with the
 * `tenant_sync` lock taken by `writeMaster`.
 */
export async function findRoleById(
  tx: TenantTx,
  tenantId: string,
  roleId: string,
): Promise<RoleDbRow | null> {
  const rows = await tx
    .select({
      id: role.id,
      code: role.code,
      name: role.name,
      isSystem: role.isSystem,
      discountLimitPct: role.discountLimitPct,
      version: role.version,
    })
    .from(role)
    .where(and(eq(role.tenantId, tenantId), eq(role.id, roleId), isNull(role.deletedAt)))
    .limit(1)
    .for('no key update')
  return rows[0] ?? null
}

export async function updateRoleRow(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    roleId: string
    name: string
    discountLimitPct: string
    nowIso: string
  },
): Promise<void> {
  await tx
    .update(role)
    .set({
      name: params.name,
      discountLimitPct: params.discountLimitPct,
      version: writer.version,
      updatedAt: params.nowIso,
      updatedBy: writer.actorUserId,
    })
    .where(and(eq(role.tenantId, writer.tenantId), eq(role.id, params.roleId)))
}

export async function syncRolePermissionsRows(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    roleId: string
    desiredCodes: ReadonlySet<string>
    newId: () => string
    nowIso: string
  },
): Promise<{ added: string[]; removed: string[] }> {
  const existing = await tx
    .select({
      id: rolePermission.id,
      permissionCode: rolePermission.permissionCode,
      deletedAt: rolePermission.deletedAt,
    })
    .from(rolePermission)
    .where(
      and(eq(rolePermission.tenantId, writer.tenantId), eq(rolePermission.roleId, params.roleId)),
    )

  const byCode = new Map(existing.map((r) => [r.permissionCode, r]))
  const added: string[] = []
  const removed: string[] = []

  const removeIds: string[] = []
  const restoreIds: string[] = []
  for (const row of existing) {
    const isActive = row.deletedAt === null
    const shouldBeActive = params.desiredCodes.has(row.permissionCode)
    if (isActive && !shouldBeActive) {
      removeIds.push(row.id)
      removed.push(row.permissionCode)
    } else if (!isActive && shouldBeActive) {
      restoreIds.push(row.id)
      added.push(row.permissionCode)
    }
  }
  if (removeIds.length > 0) {
    await tx
      .update(rolePermission)
      .set({
        deletedAt: params.nowIso,
        version: writer.version,
        updatedAt: params.nowIso,
        updatedBy: writer.actorUserId,
      })
      .where(and(eq(rolePermission.tenantId, writer.tenantId), inArray(rolePermission.id, removeIds)))
  }
  if (restoreIds.length > 0) {
    await tx
      .update(rolePermission)
      .set({
        deletedAt: null,
        version: writer.version,
        updatedAt: params.nowIso,
        updatedBy: writer.actorUserId,
      })
      .where(and(eq(rolePermission.tenantId, writer.tenantId), inArray(rolePermission.id, restoreIds)))
  }

  const newRows: Array<typeof rolePermission.$inferInsert> = []
  for (const code of params.desiredCodes) {
    if (!byCode.has(code)) {
      newRows.push({
        id: params.newId(),
        tenantId: writer.tenantId,
        roleId: params.roleId,
        permissionCode: code,
        version: writer.version,
        createdAt: params.nowIso,
        updatedAt: params.nowIso,
        createdBy: writer.actorUserId,
        updatedBy: writer.actorUserId,
      })
      added.push(code)
    }
  }
  if (newRows.length > 0) {
    await tx.insert(rolePermission).values(newRows)
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
  }
}

export async function findRoleByCode(
  tx: TenantTx,
  tenantId: string,
  code: string,
): Promise<RoleDbRow | null> {
  const rows = await tx
    .select({
      id: role.id,
      code: role.code,
      name: role.name,
      isSystem: role.isSystem,
      discountLimitPct: role.discountLimitPct,
      version: role.version,
    })
    .from(role)
    .where(and(eq(role.tenantId, tenantId), eq(role.code, code), isNull(role.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function insertRoleRow(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    id: string
    code: string
    name: string
    discountLimitPct: string
    nowIso: string
  },
): Promise<void> {
  await tx.insert(role).values({
    id: params.id,
    tenantId: writer.tenantId,
    code: params.code,
    name: params.name,
    isSystem: false,
    discountLimitPct: params.discountLimitPct,
    version: writer.version,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    createdBy: writer.actorUserId,
    updatedBy: writer.actorUserId,
  })
}

/** Tombstones the role and its permission rows in the same master version. */
export async function softDeleteRoleRows(
  tx: TenantTx,
  writer: MasterWriter,
  params: { roleId: string; nowIso: string },
): Promise<void> {
  await tx
    .update(rolePermission)
    .set({
      deletedAt: params.nowIso,
      version: writer.version,
      updatedAt: params.nowIso,
      updatedBy: writer.actorUserId,
    })
    .where(
      and(
        eq(rolePermission.tenantId, writer.tenantId),
        eq(rolePermission.roleId, params.roleId),
        isNull(rolePermission.deletedAt),
      ),
    )
  await tx
    .update(role)
    .set({
      deletedAt: params.nowIso,
      version: writer.version,
      updatedAt: params.nowIso,
      updatedBy: writer.actorUserId,
    })
    .where(and(eq(role.tenantId, writer.tenantId), eq(role.id, params.roleId)))
}

/** True when another active role already uses `name` (case-insensitive). */
export async function findRoleNameConflict(
  tx: TenantTx,
  tenantId: string,
  name: string,
  excludeRoleId?: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: role.id })
    .from(role)
    .where(
      and(
        eq(role.tenantId, tenantId),
        isNull(role.deletedAt),
        sql`lower(${role.name}) = lower(${name})`,
        excludeRoleId ? ne(role.id, excludeRoleId) : undefined,
      ),
    )
    .limit(1)
  return rows.length > 0
}

/** Active permission codes of one role. */
export async function listRolePermissionCodes(
  tx: TenantTx,
  tenantId: string,
  roleId: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ permissionCode: rolePermission.permissionCode })
    .from(rolePermission)
    .where(
      and(
        eq(rolePermission.tenantId, tenantId),
        eq(rolePermission.roleId, roleId),
        isNull(rolePermission.deletedAt),
      ),
    )
  return new Set(rows.map((r) => r.permissionCode))
}

/** Active permission rows of the given roles only (empty input returns no rows). */
export async function listRolePermissionRowsForRoles(
  tx: TenantTx,
  tenantId: string,
  roleIds: readonly string[],
): Promise<RolePermissionDbRow[]> {
  if (roleIds.length === 0) return []
  return tx
    .select({
      id: rolePermission.id,
      roleId: rolePermission.roleId,
      permissionCode: rolePermission.permissionCode,
      deletedAt: rolePermission.deletedAt,
    })
    .from(rolePermission)
    .where(
      and(
        eq(rolePermission.tenantId, tenantId),
        inArray(rolePermission.roleId, [...roleIds]),
        isNull(rolePermission.deletedAt),
      ),
    )
}

/** Discount limits (as stored) of the given active roles only. */
export async function listRoleLimitsByIds(
  tx: TenantTx,
  tenantId: string,
  roleIds: readonly string[],
): Promise<Array<{ id: string; discountLimitPct: string }>> {
  if (roleIds.length === 0) return []
  return tx
    .select({ id: role.id, discountLimitPct: role.discountLimitPct })
    .from(role)
    .where(and(eq(role.tenantId, tenantId), inArray(role.id, [...roleIds]), isNull(role.deletedAt)))
}
