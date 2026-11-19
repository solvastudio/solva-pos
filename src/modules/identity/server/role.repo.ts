import '@tanstack/react-start/server-only'
import { and, asc, eq, isNull } from 'drizzle-orm'
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

  for (const row of existing) {
    const isActive = row.deletedAt === null
    const shouldBeActive = params.desiredCodes.has(row.permissionCode)
    if (isActive && !shouldBeActive) {
      await tx
        .update(rolePermission)
        .set({
          deletedAt: params.nowIso,
          version: writer.version,
          updatedAt: params.nowIso,
          updatedBy: writer.actorUserId,
        })
        .where(
          and(eq(rolePermission.tenantId, writer.tenantId), eq(rolePermission.id, row.id)),
        )
      removed.push(row.permissionCode)
    } else if (!isActive && shouldBeActive) {
      await tx
        .update(rolePermission)
        .set({
          deletedAt: null,
          version: writer.version,
          updatedAt: params.nowIso,
          updatedBy: writer.actorUserId,
        })
        .where(
          and(eq(rolePermission.tenantId, writer.tenantId), eq(rolePermission.id, row.id)),
        )
      added.push(row.permissionCode)
    }
  }

  for (const code of params.desiredCodes) {
    if (!byCode.has(code)) {
      await tx.insert(rolePermission).values({
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

  return {
    added: added.sort(),
    removed: removed.sort(),
  }
}
