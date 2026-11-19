import '@tanstack/react-start/server-only'
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { NoTenantTx, TenantTx } from '~/server/db'
import { appUser, memberCode, outlet, role, userOutlet } from './schema'

export type MemberCodeKind = 'INVITE' | 'RESET'
export type MemberCodeRevokeReason = 'CANCELED' | 'REPLACED'

export interface AppUserDetailRow {
  id: string
  tenantId: string
  authUserId: string | null
  displayName: string
  isActive: boolean
  membershipStatus: string
  deletedAt: string | null
}

export interface PendingInviteQueryRow {
  appUserId: string
  displayName: string
  codeId: string
  email: string
  issuedBy: string | null
  createdAt: string
  expiresAt: string
}

export interface ClaimedMemberCodeRow {
  id: string
  appUserId: string
  email: string
  issuedBy: string | null
}

export async function findAppUserById(
  tx: TenantTx,
  tenantId: string,
  appUserId: string,
): Promise<AppUserDetailRow | null> {
  const rows = await tx
    .select({
      id: appUser.id,
      tenantId: appUser.tenantId,
      authUserId: appUser.authUserId,
      displayName: appUser.displayName,
      isActive: appUser.isActive,
      membershipStatus: appUser.membershipStatus,
      deletedAt: appUser.deletedAt,
    })
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), eq(appUser.id, appUserId)))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    ...row,
    id: String(row.id).toLowerCase(),
    tenantId: String(row.tenantId).toLowerCase(),
  }
}

export async function findNonDeletedAppUserByAuthUserId(
  tx: TenantTx,
  tenantId: string,
  authUserId: string,
): Promise<AppUserDetailRow | null> {
  const rows = await tx
    .select({
      id: appUser.id,
      tenantId: appUser.tenantId,
      authUserId: appUser.authUserId,
      displayName: appUser.displayName,
      isActive: appUser.isActive,
      membershipStatus: appUser.membershipStatus,
      deletedAt: appUser.deletedAt,
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
    tenantId: String(row.tenantId).toLowerCase(),
  }
}

export async function existsActiveDisplayName(
  tx: TenantTx,
  tenantId: string,
  displayName: string,
  excludeAppUserId?: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: appUser.id })
    .from(appUser)
    .where(
      and(
        eq(appUser.tenantId, tenantId),
        eq(appUser.displayName, displayName),
        isNull(appUser.deletedAt),
        eq(appUser.isActive, true),
        ...(excludeAppUserId ? [ne(appUser.id, excludeAppUserId)] : []),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export async function findTenantRoleById(
  tx: TenantTx,
  tenantId: string,
  roleId: string,
): Promise<{ id: string; code: string } | null> {
  const rows = await tx
    .select({ id: role.id, code: role.code })
    .from(role)
    .where(and(eq(role.tenantId, tenantId), eq(role.id, roleId), isNull(role.deletedAt)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { id: String(row.id).toLowerCase(), code: row.code }
}

export async function countValidTenantOutlets(
  tx: TenantTx,
  tenantId: string,
  outletIds: readonly string[],
): Promise<number> {
  if (outletIds.length === 0) return 0
  const rows = await tx
    .select({ id: outlet.id })
    .from(outlet)
    .where(
      and(
        eq(outlet.tenantId, tenantId),
        inArray(outlet.id, [...outletIds]),
        isNull(outlet.deletedAt),
      ),
    )
  return rows.length
}

export async function insertPendingAppUserRow(
  tx: TenantTx,
  writer: MasterWriter,
  params: { id: string; displayName: string; nowIso: string },
): Promise<void> {
  await tx.insert(appUser).values({
    tenantId: writer.tenantId,
    id: params.id,
    authUserId: null,
    displayName: params.displayName,
    isActive: true,
    membershipStatus: 'PENDING',
    version: writer.version,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    createdBy: writer.actorUserId,
    updatedBy: writer.actorUserId,
  })
}

export async function insertUserOutletRows(
  tx: TenantTx,
  writer: MasterWriter,
  rows: ReadonlyArray<{ id: string; userId: string; outletId: string | null; roleId: string }>,
  nowIso: string,
): Promise<void> {
  if (rows.length === 0) return
  await tx.insert(userOutlet).values(
    rows.map((r) => ({
      tenantId: writer.tenantId,
      id: r.id,
      userId: r.userId,
      outletId: r.outletId,
      roleId: r.roleId,
      version: writer.version,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: writer.actorUserId,
      updatedBy: writer.actorUserId,
    })),
  )
}

export async function activateAppUserRow(
  tx: TenantTx,
  writer: MasterWriter,
  appUserId: string,
  authUserId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(appUser)
    .set({
      authUserId,
      membershipStatus: 'ACTIVE',
      isActive: true,
      deletedAt: null,
      version: writer.version,
      updatedAt: nowIso,
      updatedBy: writer.actorUserId,
    })
    .where(and(eq(appUser.tenantId, writer.tenantId), eq(appUser.id, appUserId)))
}

export async function softDeleteAppUserAndOutlets(
  tx: TenantTx,
  writer: MasterWriter,
  appUserId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(userOutlet)
    .set({
      deletedAt: nowIso,
      version: writer.version,
      updatedAt: nowIso,
      updatedBy: writer.actorUserId,
    })
    .where(
      and(
        eq(userOutlet.tenantId, writer.tenantId),
        eq(userOutlet.userId, appUserId),
        isNull(userOutlet.deletedAt),
      ),
    )

  await tx
    .update(appUser)
    .set({
      isActive: false,
      deletedAt: nowIso,
      version: writer.version,
      updatedAt: nowIso,
      updatedBy: writer.actorUserId,
    })
    .where(and(eq(appUser.tenantId, writer.tenantId), eq(appUser.id, appUserId)))
}

export async function listUserOutletBindings(
  tx: TenantTx,
  tenantId: string,
  appUserIds: readonly string[],
): Promise<Array<{ userId: string; roleId: string; outletId: string | null }>> {
  if (appUserIds.length === 0) return []
  const rows = await tx
    .select({
      userId: userOutlet.userId,
      roleId: userOutlet.roleId,
      outletId: userOutlet.outletId,
    })
    .from(userOutlet)
    .where(
      and(
        eq(userOutlet.tenantId, tenantId),
        inArray(userOutlet.userId, [...appUserIds]),
        isNull(userOutlet.deletedAt),
      ),
    )

  return rows.map((r) => ({
    userId: String(r.userId).toLowerCase(),
    roleId: String(r.roleId).toLowerCase(),
    outletId: r.outletId ? String(r.outletId).toLowerCase() : null,
  }))
}

export async function listUserRoleCodesForAppUser(
  tx: TenantTx,
  tenantId: string,
  appUserId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ code: role.code })
    .from(userOutlet)
    .innerJoin(
      role,
      and(eq(role.tenantId, userOutlet.tenantId), eq(role.id, userOutlet.roleId), isNull(role.deletedAt)),
    )
    .where(
      and(
        eq(userOutlet.tenantId, tenantId),
        eq(userOutlet.userId, appUserId),
        isNull(userOutlet.deletedAt),
      ),
    )
  return rows.map((r) => r.code)
}

export async function countActiveOwnersExcluding(
  tx: TenantTx,
  tenantId: string,
  excludeAppUserId: string,
): Promise<number> {
  const rows = await tx
    .selectDistinct({ userId: appUser.id })
    .from(appUser)
    .innerJoin(
      userOutlet,
      and(
        eq(userOutlet.tenantId, appUser.tenantId),
        eq(userOutlet.userId, appUser.id),
        isNull(userOutlet.deletedAt),
      ),
    )
    .innerJoin(
      role,
      and(eq(role.tenantId, userOutlet.tenantId), eq(role.id, userOutlet.roleId), isNull(role.deletedAt)),
    )
    .where(
      and(
        eq(appUser.tenantId, tenantId),
        eq(appUser.isActive, true),
        eq(appUser.membershipStatus, 'ACTIVE'),
        isNull(appUser.deletedAt),
        eq(role.code, 'OWNER'),
        ne(appUser.id, excludeAppUserId),
      ),
    )
  return rows.length
}

export async function revokeActiveMemberCodes(
  tx: TenantTx,
  tenantId: string,
  appUserId: string,
  reason: MemberCodeRevokeReason,
  nowIso: string,
  kind?: MemberCodeKind,
): Promise<void> {
  await tx
    .update(memberCode)
    .set({
      revokedAt: nowIso,
      revokeReason: reason,
    })
    .where(
      and(
        eq(memberCode.tenantId, tenantId),
        eq(memberCode.appUserId, appUserId),
        ...(kind ? [eq(memberCode.kind, kind)] : []),
        isNull(memberCode.usedAt),
        isNull(memberCode.revokedAt),
      ),
    )
}

export async function insertMemberCodeRow(
  tx: TenantTx,
  params: {
    id: string
    tenantId: string
    appUserId: string
    kind: MemberCodeKind
    email: string
    codeHash: Buffer
    expiresAt: string
    issuedBy: string | null
    createdAt: string
  },
): Promise<void> {
  await tx.insert(memberCode).values({
    id: params.id,
    tenantId: params.tenantId,
    appUserId: params.appUserId,
    kind: params.kind,
    email: params.email,
    codeHash: params.codeHash,
    expiresAt: params.expiresAt,
    issuedBy: params.issuedBy,
    createdAt: params.createdAt,
  })
}

export async function lockLatestInviteCodeForUser(
  tx: TenantTx,
  tenantId: string,
  appUserId: string,
): Promise<{
  id: string
  email: string
  usedAt: string | null
  revokedAt: string | null
  expiresAt: string
} | null> {
  const res = await tx.execute(
    sql`SELECT id, email::text AS email, used_at, revoked_at, expires_at
        FROM member_code
        WHERE tenant_id = ${tenantId}::uuid
          AND app_user_id = ${appUserId}::uuid
          AND kind = 'INVITE'
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
  )
  const row = res.rows[0] as
    | {
        id: unknown
        email: unknown
        used_at: unknown
        revoked_at: unknown
        expires_at: unknown
      }
    | undefined
  if (!row) return null
  return {
    id: String(row.id).toLowerCase(),
    email: String(row.email).toLowerCase(),
    usedAt: row.used_at ? String(row.used_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    expiresAt: String(row.expires_at),
  }
}

export async function listPendingInviteRows(
  tx: TenantTx,
  tenantId: string,
): Promise<PendingInviteQueryRow[]> {
  const res = await tx.execute(
    sql`SELECT
          au.id AS app_user_id,
          au.display_name,
          mc.id AS code_id,
          mc.email::text AS email,
          mc.issued_by,
          mc.created_at,
          mc.expires_at
        FROM app_user au
        CROSS JOIN LATERAL (
          SELECT id, email, issued_by, created_at, expires_at, used_at, revoked_at
          FROM member_code
          WHERE tenant_id = au.tenant_id
            AND app_user_id = au.id
            AND kind = 'INVITE'
          ORDER BY created_at DESC
          LIMIT 1
        ) mc
        WHERE au.tenant_id = ${tenantId}::uuid
          AND au.membership_status = 'PENDING'
          AND au.deleted_at IS NULL
          AND mc.used_at IS NULL
          AND mc.revoked_at IS NULL
        ORDER BY mc.created_at DESC`,
  )

  return res.rows.map((r) => {
    const row = r as Record<string, unknown>
    return {
      appUserId: String(row.app_user_id).toLowerCase(),
      displayName: String(row.display_name),
      codeId: String(row.code_id).toLowerCase(),
      email: String(row.email).toLowerCase(),
      issuedBy: row.issued_by ? String(row.issued_by).toLowerCase() : null,
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
    }
  })
}

export async function findActiveInviteEmailForUser(
  tx: TenantTx,
  tenantId: string,
  appUserId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ email: memberCode.email })
    .from(memberCode)
    .where(
      and(
        eq(memberCode.tenantId, tenantId),
        eq(memberCode.appUserId, appUserId),
        eq(memberCode.kind, 'INVITE'),
        isNull(memberCode.usedAt),
        isNull(memberCode.revokedAt),
      ),
    )
    .orderBy(desc(memberCode.createdAt))
    .limit(1)
  return rows[0] ? rows[0].email.toLowerCase() : null
}

export async function atomicClaimMemberCode(
  tx: TenantTx,
  tenantId: string,
  codeHash: Buffer,
  kind: MemberCodeKind,
  email: string,
  nowIso: string,
): Promise<ClaimedMemberCodeRow | null> {
  const res = await tx.execute(
    sql`UPDATE member_code
        SET used_at = ${nowIso}::timestamptz
        WHERE tenant_id = ${tenantId}::uuid
          AND code_hash = ${codeHash}
          AND kind = ${kind}
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > ${nowIso}::timestamptz
          AND email = ${email}::citext
        RETURNING id, app_user_id, email::text AS email, issued_by`,
  )

  const row = res.rows[0] as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: String(row.id).toLowerCase(),
    appUserId: String(row.app_user_id).toLowerCase(),
    email: String(row.email).toLowerCase(),
    issuedBy: row.issued_by ? String(row.issued_by).toLowerCase() : null,
  }
}

export async function updateMemberCodeRedeemedAuthUser(
  tx: TenantTx,
  tenantId: string,
  codeId: string,
  authUserId: string,
): Promise<void> {
  await tx
    .update(memberCode)
    .set({ redeemedAuthUserId: authUserId })
    .where(and(eq(memberCode.tenantId, tenantId), eq(memberCode.id, codeId)))
}

export async function callAuthAccountMembershipCount(
  tx: TenantTx,
  authUserId: string,
): Promise<number> {
  const res = await tx.execute(
    sql`SELECT auth_account_membership_count(${authUserId}) AS cnt`,
  )
  const raw = (res.rows[0] as { cnt?: unknown } | undefined)?.cnt
  return Number(raw ?? 0)
}

export async function deleteSettledOrOldMemberCodes(
  tx: TenantTx,
  tenantId: string,
  cutoffIso: string,
): Promise<number> {
  const res = await tx.execute(
    sql`DELETE FROM member_code
        WHERE tenant_id = ${tenantId}::uuid
          AND COALESCE(used_at, revoked_at, expires_at) < ${cutoffIso}::timestamptz
        RETURNING id`,
  )
  return res.rows.length
}

export async function listOrphanPendingAppUsers(
  tx: TenantTx,
  tenantId: string,
): Promise<string[]> {
  const res = await tx.execute(
    sql`SELECT au.id
        FROM app_user au
        WHERE au.tenant_id = ${tenantId}::uuid
          AND au.membership_status = 'PENDING'
          AND au.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM member_code mc
            WHERE mc.tenant_id = au.tenant_id
              AND mc.app_user_id = au.id
          )`,
  )
  return res.rows.map((r) => String((r as { id: unknown }).id).toLowerCase())
}

export async function listActiveTenantIds(tx: NoTenantTx | TenantTx): Promise<string[]> {
  const res = await tx.execute(sql`SELECT id FROM list_active_tenants()`)
  return res.rows.map((r) => String((r as { id: unknown }).id).toLowerCase())
}
