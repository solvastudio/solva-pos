import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { isUuid } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { getLimiters } from '~/server/auth/rate-limit/limiters'
import { withTenant } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { findAuthUserByEmail } from './auth-account.repo'
import {
  addHoursIso,
  generateOneTimeMemberCode,
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import {
  countValidTenantOutlets,
  existsActiveDisplayName,
  findActiveInviteEmailForUser,
  findAppUserById,
  findNonDeletedAppUserByAuthUserId,
  findTenantRoleById,
  insertMemberCodeRow,
  insertPendingAppUserRow,
  insertUserOutletRows,
  listPendingInviteRows,
  listUserOutletBindings,
  lockLatestInviteCodeForUser,
  revokeActiveMemberCodes,
  softDeleteAppUserAndOutlets,
} from './member-code.repo'

const INVITE_TTL_HOURS = 72

const emailSchema = z.string().trim().toLowerCase().email().max(254)
const displayNameSchema = z.string().trim().min(1).max(80)

export interface CreateInviteInput {
  email: string
  displayName: string
  roleId: string
  outletIds: string[] | null
  existingAppUserId?: string
}

export interface CreateInviteResult {
  appUserId: string
  codeId: string
  code: string
  expiresAt: string
}

export interface PendingInviteItem {
  id: string
  email: string
  displayName: string
  roleId: string | null
  outletIds: string[] | null
  issuedBy: string | null
  createdAt: string
  expiresAt: string
  status: 'PENDING' | 'EXPIRED'
}

export interface ReissueInviteResult {
  codeId: string
  code: string
  expiresAt: string
}

async function consumeIssueRateLimits(
  tenantId: string,
  email: string,
  nowMs: number,
): Promise<void> {
  const limiters = getLimiters()
  const tenantDecision = await limiters.issueTenant.consume(tenantId, nowMs)
  if (!tenantDecision.allowed) {
    throw new AppError('RATE_LIMITED', 'error.RATE_LIMITED.action')
  }
  const emailDecision = await limiters.issueEmail.consume(`${tenantId}:${email}`, nowMs)
  if (!emailDecision.allowed) {
    throw new AppError('RATE_LIMITED', 'error.RATE_LIMITED.action')
  }
}

export async function createInvite(
  actor: IdentityAuthActor,
  input: CreateInviteInput,
  deps?: IdentityServiceDeps,
): Promise<CreateInviteResult> {
  requireActorPermission(actor, 'user.invite')

  const parsedEmail = emailSchema.safeParse(input.email)
  if (!parsedEmail.success) {
    throw new AppError('VALIDATION_FAILED', 'member.add.failed')
  }
  const email = parsedEmail.data

  const parsedName = displayNameSchema.safeParse(input.displayName)
  if (!parsedName.success) {
    throw new AppError('VALIDATION_FAILED', 'member.add.failed')
  }
  const displayName = parsedName.data

  if (!isUuid(input.roleId)) {
    throw new AppError('VALIDATION_FAILED', 'member.add.failed')
  }
  if (input.outletIds !== null) {
    if (!Array.isArray(input.outletIds) || input.outletIds.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'member.add.failed')
    }
    for (const id of input.outletIds) {
      if (!isUuid(id)) {
        throw new AppError('VALIDATION_FAILED', 'member.add.failed')
      }
    }
  }
  if (input.existingAppUserId !== undefined && !isUuid(input.existingAppUserId)) {
    throw new AppError('VALIDATION_FAILED', 'member.add.failed')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const nowMs = Date.parse(nowIso)
  await consumeIssueRateLimits(actor.tenantId, email, nowMs)

  const uniqueOutlets = input.outletIds ? Array.from(new Set(input.outletIds)) : null
  const generated = generateOneTimeMemberCode(deps)
  const codeId = identityIdGen.newId()
  const expiresAt = addHoursIso(nowIso, INVITE_TTL_HOURS)

  return withTenant(actor.tenantId, async (tx) => {
    const roleRow = await findTenantRoleById(tx, actor.tenantId, input.roleId)
    if (!roleRow) {
      throw new AppError('VALIDATION_FAILED', 'member.add.failed')
    }

    if (uniqueOutlets) {
      const validCount = await countValidTenantOutlets(tx, actor.tenantId, uniqueOutlets)
      if (validCount !== uniqueOutlets.length) {
        throw new AppError('VALIDATION_FAILED', 'member.add.failed')
      }
    }

    const existingAuthUser = await findAuthUserByEmail(tx, email)
    if (existingAuthUser) {
      const activeMember = await findNonDeletedAppUserByAuthUserId(
        tx,
        actor.tenantId,
        existingAuthUser.id,
      )
      if (activeMember) {
        throw new AppError('VALIDATION_FAILED', 'member.add.already')
      }
    }

    let targetAppUserId: string
    if (input.existingAppUserId) {
      const existingProfile = await findAppUserById(tx, actor.tenantId, input.existingAppUserId)
      if (!existingProfile || existingProfile.deletedAt !== null || existingProfile.authUserId !== null) {
        throw new AppError('VALIDATION_FAILED', 'member.add.failed')
      }
      targetAppUserId = existingProfile.id
    } else {
      const nameTaken = await existsActiveDisplayName(tx, actor.tenantId, displayName)
      if (nameTaken) {
        throw new AppError('VALIDATION_FAILED', 'member.add.failed')
      }
      targetAppUserId = identityIdGen.newId()
      const outletTargets = uniqueOutlets ?? [null]
      await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        await insertPendingAppUserRow(tx, w, {
          id: targetAppUserId,
          displayName,
          nowIso,
        })
        await insertUserOutletRows(
          tx,
          w,
          outletTargets.map((outletId) => ({
            id: identityIdGen.newId(),
            userId: targetAppUserId,
            outletId,
            roleId: roleRow.id,
          })),
          nowIso,
        )
        return true
      })
    }

    await revokeActiveMemberCodes(tx, actor.tenantId, targetAppUserId, 'REPLACED', nowIso, 'INVITE')
    await insertMemberCodeRow(tx, {
      id: codeId,
      tenantId: actor.tenantId,
      appUserId: targetAppUserId,
      kind: 'INVITE',
      email,
      codeHash: generated.codeHash,
      expiresAt,
      issuedBy: actor.appUserId,
      createdAt: nowIso,
    })

    await appendAudit(
      tx,
      {
        action: 'member.invited',
        entityType: 'app_user',
        entityId: targetAppUserId,
        afterData: {
          email,
          roleId: roleRow.id,
          outletIds: uniqueOutlets,
          codeId,
        },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return {
      appUserId: targetAppUserId,
      codeId,
      code: generated.formatted,
      expiresAt,
    }
  })
}

export async function listPendingInvites(
  actor: IdentityAuthActor,
  deps?: IdentityServiceDeps,
): Promise<PendingInviteItem[]> {
  requireActorPermission(actor, 'user.invite')
  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const nowMs = Date.parse(nowIso)

  return withTenant(actor.tenantId, async (tx) => {
    const rows = await listPendingInviteRows(tx, actor.tenantId)
    const bindings = await listUserOutletBindings(
      tx,
      actor.tenantId,
      rows.map((r) => r.appUserId),
    )

    const byUser = new Map<string, { roleId: string | null; outletIds: Set<string>; all: boolean }>()
    for (const b of bindings) {
      let entry = byUser.get(b.userId)
      if (!entry) {
        entry = { roleId: b.roleId, outletIds: new Set<string>(), all: false }
        byUser.set(b.userId, entry)
      }
      if (b.outletId === null) {
        entry.all = true
      } else {
        entry.outletIds.add(b.outletId)
      }
    }

    return rows.map((row) => {
      const bound = byUser.get(row.appUserId)
      const expiresMs = Date.parse(row.expiresAt)
      return {
        id: row.appUserId,
        email: row.email,
        displayName: row.displayName,
        roleId: bound?.roleId ?? null,
        outletIds: !bound || bound.all ? null : [...bound.outletIds].sort(),
        issuedBy: row.issuedBy,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        status: expiresMs > nowMs ? 'PENDING' : 'EXPIRED',
      }
    })
  })
}

export async function cancelInvite(
  actor: IdentityAuthActor,
  appUserId: string,
  deps?: IdentityServiceDeps,
): Promise<void> {
  requireActorPermission(actor, 'user.invite')
  if (!isUuid(appUserId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid user id')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  let emailForLimitReset: string | null = null

  await withTenant(actor.tenantId, async (tx) => {
    const profile = await findAppUserById(tx, actor.tenantId, appUserId)
    if (!profile) {
      return
    }

    emailForLimitReset = await findActiveInviteEmailForUser(tx, actor.tenantId, appUserId)
    await revokeActiveMemberCodes(tx, actor.tenantId, appUserId, 'CANCELED', nowIso, 'INVITE')

    if (profile.membershipStatus === 'PENDING' && profile.deletedAt === null) {
      await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        await softDeleteAppUserAndOutlets(tx, w, appUserId, nowIso)
        return true
      })
    }

    if (emailForLimitReset !== null || profile.membershipStatus === 'PENDING') {
      await appendAudit(
        tx,
        {
          action: 'member.invite_canceled',
          entityType: 'app_user',
          entityId: appUserId,
          beforeData: {
            ...(emailForLimitReset ? { email: emailForLimitReset } : {}),
            membershipStatus: profile.membershipStatus,
          },
          actorUserId: actor.appUserId,
          occurredAt: nowIso,
        },
        { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
      )
    }
  })

  if (emailForLimitReset) {
    await getLimiters().redeemEmail.reset(`${actor.tenantSlug}:${emailForLimitReset}`)
  }
}

export async function reissueInvite(
  actor: IdentityAuthActor,
  appUserId: string,
  deps?: IdentityServiceDeps,
): Promise<ReissueInviteResult> {
  requireActorPermission(actor, 'user.invite')
  if (!isUuid(appUserId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid user id')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const nowMs = Date.parse(nowIso)
  const generated = generateOneTimeMemberCode(deps)
  const newCodeId = identityIdGen.newId()
  const expiresAt = addHoursIso(nowIso, INVITE_TTL_HOURS)

  const result = await withTenant(actor.tenantId, async (tx) => {
    const profile = await findAppUserById(tx, actor.tenantId, appUserId)
    if (!profile || profile.deletedAt !== null || profile.authUserId !== null) {
      throw new AppError('VALIDATION_FAILED', 'member.add.failed')
    }

    const latestInvite = await lockLatestInviteCodeForUser(tx, actor.tenantId, appUserId)
    if (!latestInvite || latestInvite.usedAt !== null || latestInvite.revokedAt !== null) {
      throw new AppError('VALIDATION_FAILED', 'member.add.failed')
    }

    const existingAuthUser = await findAuthUserByEmail(tx, latestInvite.email)
    if (existingAuthUser) {
      const activeMember = await findNonDeletedAppUserByAuthUserId(
        tx,
        actor.tenantId,
        existingAuthUser.id,
      )
      if (activeMember) {
        throw new AppError('VALIDATION_FAILED', 'member.add.already')
      }
    }

    await consumeIssueRateLimits(actor.tenantId, latestInvite.email, nowMs)

    await revokeActiveMemberCodes(tx, actor.tenantId, appUserId, 'REPLACED', nowIso, 'INVITE')
    await insertMemberCodeRow(tx, {
      id: newCodeId,
      tenantId: actor.tenantId,
      appUserId,
      kind: 'INVITE',
      email: latestInvite.email,
      codeHash: generated.codeHash,
      expiresAt,
      issuedBy: actor.appUserId,
      createdAt: nowIso,
    })

    await appendAudit(
      tx,
      {
        action: 'member.invite_reissued',
        entityType: 'member_code',
        entityId: newCodeId,
        beforeData: { codeId: latestInvite.id, email: latestInvite.email },
        afterData: { codeId: newCodeId, email: latestInvite.email, expiresAt },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return {
      email: latestInvite.email,
      codeId: newCodeId,
      code: generated.formatted,
      expiresAt,
    }
  })

  await getLimiters().redeemEmail.reset(`${actor.tenantSlug}:${result.email}`)
  return {
    codeId: result.codeId,
    code: result.code,
    expiresAt: result.expiresAt,
  }
}
