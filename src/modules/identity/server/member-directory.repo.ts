import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { assignmentOutletKey } from '../domain/assignment-key'
import { appUser, memberCode, outlet, role, userOutlet } from './schema'

export interface MemberAppUserRow {
  id: string
  displayName: string
  membershipStatus: string
  isActive: boolean
}

export interface MemberAssignmentDbRow {
  id: string
  userId: string
  outletId: string | null
  outletCode: string | null
  outletName: string | null
  roleId: string
  roleCode: string
  roleName: string
}

export async function listMemberEmailsViaDefiner(tx: TenantTx): Promise<Map<string, string>> {
  const res = await tx.execute(sql`SELECT app_user_id, email FROM tenant_member_emails()`)
  const out = new Map<string, string>()
  for (const row of res.rows) {
    const r = row as { app_user_id: unknown; email: unknown }
    if (r.app_user_id && r.email) {
      out.set(String(r.app_user_id), String(r.email))
    }
  }
  return out
}

export async function listMemberAppUsers(
  tx: TenantTx,
  tenantId: string,
): Promise<MemberAppUserRow[]> {
  return tx
    .select({
      id: appUser.id,
      displayName: appUser.displayName,
      membershipStatus: appUser.membershipStatus,
      isActive: appUser.isActive,
    })
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), isNull(appUser.deletedAt)))
    .orderBy(asc(appUser.displayName))
}

export async function listPendingInviteEmailsForUsers(
  tx: TenantTx,
  tenantId: string,
  appUserIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (appUserIds.length === 0) return out
  const rows = await tx
    .select({
      appUserId: memberCode.appUserId,
      email: memberCode.email,
    })
    .from(memberCode)
    .where(
      and(
        eq(memberCode.tenantId, tenantId),
        eq(memberCode.kind, 'INVITE'),
        inArray(memberCode.appUserId, [...appUserIds]),
        isNull(memberCode.usedAt),
        isNull(memberCode.revokedAt),
      ),
    )
  for (const r of rows) {
    out.set(r.appUserId, r.email)
  }
  return out
}

export async function listMemberOutletAssignments(
  tx: TenantTx,
  tenantId: string,
  userId?: string,
): Promise<MemberAssignmentDbRow[]> {
  return tx
    .select({
      id: userOutlet.id,
      userId: userOutlet.userId,
      outletId: userOutlet.outletId,
      outletCode: outlet.code,
      outletName: outlet.name,
      roleId: userOutlet.roleId,
      roleCode: role.code,
      roleName: role.name,
    })
    .from(userOutlet)
    .innerJoin(role, and(eq(role.tenantId, userOutlet.tenantId), eq(role.id, userOutlet.roleId)))
    .leftJoin(
      outlet,
      and(
        eq(outlet.tenantId, userOutlet.tenantId),
        eq(outlet.id, userOutlet.outletId),
        isNull(outlet.deletedAt),
      ),
    )
    .where(
      and(
        eq(userOutlet.tenantId, tenantId),
        userId ? eq(userOutlet.userId, userId) : undefined,
        isNull(userOutlet.deletedAt),
        isNull(role.deletedAt),
      ),
    )
    .orderBy(asc(outlet.code), asc(role.code))
}

export interface ActiveUserRole {
  roleId: string
  roleCode: string
  discountLimitPct: number
}

/** Distinct active roles assigned to a member at any outlet. */
export async function listActiveRolesOfUser(
  tx: TenantTx,
  tenantId: string,
  appUserId: string,
): Promise<ActiveUserRole[]> {
  const rows = await tx
    .select({
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
  const byId = new Map<string, ActiveUserRole>()
  for (const r of rows) {
    byId.set(r.roleId, {
      roleId: r.roleId,
      roleCode: r.roleCode,
      discountLimitPct: Number(r.discountLimitPct),
    })
  }
  return [...byId.values()]
}

/** Distinct active members per role id (members removed from the tenant are not counted). */
export async function countActiveMembersByRole(
  tx: TenantTx,
  tenantId: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      roleId: userOutlet.roleId,
      members: sql<number>`count(distinct ${userOutlet.userId})::int`,
    })
    .from(userOutlet)
    .innerJoin(
      appUser,
      and(
        eq(appUser.tenantId, userOutlet.tenantId),
        eq(appUser.id, userOutlet.userId),
        isNull(appUser.deletedAt),
      ),
    )
    .where(and(eq(userOutlet.tenantId, tenantId), isNull(userOutlet.deletedAt)))
    .groupBy(userOutlet.roleId)
  return new Map(rows.map((r) => [r.roleId, Number(r.members)]))
}

export async function countActiveMembersForRole(
  tx: TenantTx,
  tenantId: string,
  roleId: string,
): Promise<number> {
  const rows = await tx
    .select({ members: sql<number>`count(distinct ${userOutlet.userId})::int` })
    .from(userOutlet)
    .innerJoin(
      appUser,
      and(
        eq(appUser.tenantId, userOutlet.tenantId),
        eq(appUser.id, userOutlet.userId),
        isNull(appUser.deletedAt),
      ),
    )
    .where(
      and(
        eq(userOutlet.tenantId, tenantId),
        eq(userOutlet.roleId, roleId),
        isNull(userOutlet.deletedAt),
      ),
    )
  return Number(rows[0]?.members ?? 0)
}

export async function listRolesByIds(
  tx: TenantTx,
  tenantId: string,
  roleIds: readonly string[],
): Promise<Array<{ id: string; code: string }>> {
  if (roleIds.length === 0) return []
  return tx
    .select({ id: role.id, code: role.code })
    .from(role)
    .where(
      and(eq(role.tenantId, tenantId), inArray(role.id, [...roleIds]), isNull(role.deletedAt)),
    )
}

export async function listOutletsByIds(
  tx: TenantTx,
  tenantId: string,
  outletIds: readonly string[],
): Promise<Array<{ id: string }>> {
  if (outletIds.length === 0) return []
  return tx
    .select({ id: outlet.id })
    .from(outlet)
    .where(
      and(
        eq(outlet.tenantId, tenantId),
        inArray(outlet.id, [...outletIds]),
        isNull(outlet.deletedAt),
      ),
    )
}

export async function findActiveMemberTarget(
  tx: TenantTx,
  tenantId: string,
  appUserId: string,
): Promise<{
  id: string
  displayName: string
  membershipStatus: string
  isActive: boolean
} | null> {
  const rows = await tx
    .select({
      id: appUser.id,
      displayName: appUser.displayName,
      membershipStatus: appUser.membershipStatus,
      isActive: appUser.isActive,
    })
    .from(appUser)
    .where(
      and(
        eq(appUser.tenantId, tenantId),
        eq(appUser.id, appUserId),
        isNull(appUser.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function replaceUserOutlets(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    appUserId: string
    assignments: ReadonlyArray<{ outletId: string | null; roleId: string }>
    newId: () => string
    nowIso: string
  },
): Promise<{
  before: Array<{ outletId: string | null; roleId: string }>
  after: Array<{ outletId: string | null; roleId: string }>
}> {
  const existing = await tx
    .select({
      id: userOutlet.id,
      outletId: userOutlet.outletId,
      roleId: userOutlet.roleId,
    })
    .from(userOutlet)
    .where(
      and(
        eq(userOutlet.tenantId, writer.tenantId),
        eq(userOutlet.userId, params.appUserId),
        isNull(userOutlet.deletedAt),
      ),
    )

  const before = existing.map((e) => ({ outletId: e.outletId, roleId: e.roleId }))
  const existingByOutletKey = new Map(existing.map((e) => [assignmentOutletKey(e.outletId), e]))
  const desiredByOutletKey = new Map(
    params.assignments.map((a) => [assignmentOutletKey(a.outletId), a]),
  )

  const removeIds = existing
    .filter((row) => !desiredByOutletKey.has(assignmentOutletKey(row.outletId)))
    .map((row) => row.id)
  if (removeIds.length > 0) {
    await tx
      .update(userOutlet)
      .set({
        deletedAt: params.nowIso,
        version: writer.version,
        updatedAt: params.nowIso,
        updatedBy: writer.actorUserId,
      })
      .where(and(eq(userOutlet.tenantId, writer.tenantId), inArray(userOutlet.id, removeIds)))
  }

  // Rows that only change role are grouped per target role: one UPDATE per distinct role.
  const reassignIdsByRole = new Map<string, string[]>()
  const newRows: Array<typeof userOutlet.$inferInsert> = []
  for (const target of desiredByOutletKey.values()) {
    const prev = existingByOutletKey.get(assignmentOutletKey(target.outletId))
    if (!prev) {
      newRows.push({
        id: params.newId(),
        tenantId: writer.tenantId,
        userId: params.appUserId,
        outletId: target.outletId,
        roleId: target.roleId,
        version: writer.version,
        createdAt: params.nowIso,
        updatedAt: params.nowIso,
        createdBy: writer.actorUserId,
        updatedBy: writer.actorUserId,
      })
    } else if (prev.roleId !== target.roleId) {
      reassignIdsByRole.set(target.roleId, [...(reassignIdsByRole.get(target.roleId) ?? []), prev.id])
    }
  }
  for (const [roleId, ids] of reassignIdsByRole) {
    await tx
      .update(userOutlet)
      .set({
        roleId,
        version: writer.version,
        updatedAt: params.nowIso,
        updatedBy: writer.actorUserId,
      })
      .where(and(eq(userOutlet.tenantId, writer.tenantId), inArray(userOutlet.id, ids)))
  }
  if (newRows.length > 0) {
    await tx.insert(userOutlet).values(newRows)
  }

  await tx
    .update(appUser)
    .set({
      version: writer.version,
      updatedAt: params.nowIso,
      updatedBy: writer.actorUserId,
    })
    .where(and(eq(appUser.tenantId, writer.tenantId), eq(appUser.id, params.appUserId)))

  return {
    before,
    after: Array.from(desiredByOutletKey.values()),
  }
}

/** Distinct active members holding `roleId`; `outletIds` limits to assignments at those outlets (`null` = every outlet). */
export async function listRoleMemberRows(
  tx: TenantTx,
  tenantId: string,
  roleId: string,
  outletIds: readonly string[] | null,
): Promise<Array<{ appUserId: string; displayName: string }>> {
  if (outletIds !== null && outletIds.length === 0) {
    return []
  }
  return tx
    .selectDistinct({ appUserId: appUser.id, displayName: appUser.displayName })
    .from(userOutlet)
    .innerJoin(
      appUser,
      and(
        eq(appUser.tenantId, userOutlet.tenantId),
        eq(appUser.id, userOutlet.userId),
        isNull(appUser.deletedAt),
      ),
    )
    .where(
      and(
        eq(userOutlet.tenantId, tenantId),
        eq(userOutlet.roleId, roleId),
        isNull(userOutlet.deletedAt),
        outletIds === null ? undefined : inArray(userOutlet.outletId, [...outletIds]),
      ),
    )
    .orderBy(asc(appUser.displayName))
}
