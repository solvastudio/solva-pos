import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
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
        isNull(userOutlet.deletedAt),
        isNull(role.deletedAt),
      ),
    )
    .orderBy(asc(outlet.code), asc(role.code))
}

export async function listActorRoleCodes(
  tx: TenantTx,
  tenantId: string,
  appUserId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ roleCode: role.code })
    .from(userOutlet)
    .innerJoin(role, and(eq(role.tenantId, userOutlet.tenantId), eq(role.id, userOutlet.roleId)))
    .where(
      and(
        eq(userOutlet.tenantId, tenantId),
        eq(userOutlet.userId, appUserId),
        isNull(userOutlet.deletedAt),
        isNull(role.deletedAt),
      ),
    )
  return Array.from(new Set(rows.map((r) => r.roleCode)))
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
): Promise<{ id: string; membershipStatus: string; isActive: boolean } | null> {
  const rows = await tx
    .select({
      id: appUser.id,
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
  const existingByOutletKey = new Map(existing.map((e) => [e.outletId ?? '__ALL__', e]))
  const desiredByOutletKey = new Map(
    params.assignments.map((a) => [a.outletId ?? '__ALL__', a]),
  )

  for (const row of existing) {
    const key = row.outletId ?? '__ALL__'
    if (!desiredByOutletKey.has(key)) {
      await tx
        .update(userOutlet)
        .set({
          deletedAt: params.nowIso,
          version: writer.version,
          updatedAt: params.nowIso,
          updatedBy: writer.actorUserId,
        })
        .where(and(eq(userOutlet.tenantId, writer.tenantId), eq(userOutlet.id, row.id)))
    }
  }

  for (const target of desiredByOutletKey.values()) {
    const key = target.outletId ?? '__ALL__'
    const prev = existingByOutletKey.get(key)
    if (prev) {
      if (prev.roleId !== target.roleId) {
        await tx
          .update(userOutlet)
          .set({
            roleId: target.roleId,
            version: writer.version,
            updatedAt: params.nowIso,
            updatedBy: writer.actorUserId,
          })
          .where(and(eq(userOutlet.tenantId, writer.tenantId), eq(userOutlet.id, prev.id)))
      }
    } else {
      await tx.insert(userOutlet).values({
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
    }
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
