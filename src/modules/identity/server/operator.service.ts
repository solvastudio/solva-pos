import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { isUuid } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { getLimiters } from '~/server/auth/rate-limit/limiters'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { createLogger } from '~/server/log'
import { findAuthUserEmailById } from './auth-account.repo'
import {
  addHoursIso,
  generateOneTimeMemberCode,
  identityIdGen,
  type IdentityServiceDeps,
} from './code-crypto'
import { issueInviteCore, type PendingInviteItem, type ReissueInviteResult } from './invite.service'
import {
  findActiveInviteEmailForUser,
  findAppUserById,
  insertMemberCodeRow,
  listPendingInviteRows,
  listUserOutletBindings,
  lockLatestInviteCodeForUser,
  revokeActiveMemberCodes,
  softDeleteAppUserAndOutlets,
} from './member-code.repo'
import {
  findTenantDetailRow,
  listTenantMembersOverview,
  type TenantDetailRow,
  type TenantMemberOverviewRow,
} from './tenant.repo'
import type { PlatformOperatorActor } from './tenant.service'
import { writeMaster } from '~/modules/sync/public'

const log = createLogger('platform.op')
const RESET_TTL_HOURS = 24

function hashEmailShort(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 8)
}

export interface PlatformTenantView {
  tenant: TenantDetailRow
  members: TenantMemberOverviewRow[]
  pendingInvites: PendingInviteItem[]
}

export async function getPlatformTenantView(
  _op: PlatformOperatorActor,
  tenantId: string,
  deps?: IdentityServiceDeps,
): Promise<PlatformTenantView | null> {
  if (!isUuid(tenantId)) {
    return null
  }
  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const nowMs = Date.parse(nowIso)

  return withTenantReadOnly(tenantId, async (tx) => {
    const tenant = await findTenantDetailRow(tx, tenantId)
    if (!tenant) return null

    const members = await listTenantMembersOverview(tx, tenantId)
    const inviteRows = await listPendingInviteRows(tx, tenantId)
    const bindings = await listUserOutletBindings(
      tx,
      tenantId,
      inviteRows.map((r) => r.appUserId),
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

    const pendingInvites: PendingInviteItem[] = inviteRows.map((row) => {
      const bound = byUser.get(row.appUserId)
      return {
        id: row.appUserId,
        email: row.email,
        displayName: row.displayName,
        roleId: bound?.roleId ?? null,
        outletIds: !bound || bound.all ? null : [...bound.outletIds].sort(),
        issuedBy: row.issuedBy,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        status: Date.parse(row.expiresAt) > nowMs ? 'PENDING' : 'EXPIRED',
      }
    })

    return { tenant, members, pendingInvites }
  })
}

export async function listOwnerInvites(
  op: PlatformOperatorActor,
  tenantId: string,
  deps?: IdentityServiceDeps,
): Promise<PendingInviteItem[]> {
  const view = await getPlatformTenantView(op, tenantId, deps)
  if (!view) {
    throw new AppError('VALIDATION_FAILED', 'Tenant not found')
  }
  return view.pendingInvites
}

export async function cancelOwnerInvite(
  op: PlatformOperatorActor,
  tenantId: string,
  appUserId: string,
  deps?: IdentityServiceDeps,
): Promise<void> {
  if (!isUuid(tenantId) || !isUuid(appUserId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid identifier')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  let emailForReset: string | null = null
  let tenantSlug = ''

  await withTenant(tenantId, async (tx) => {
    const tenantRow = await findTenantDetailRow(tx, tenantId)
    if (!tenantRow) {
      throw new AppError('VALIDATION_FAILED', 'Tenant not found')
    }
    tenantSlug = tenantRow.slug

    const profile = await findAppUserById(tx, tenantId, appUserId)
    if (!profile) return

    emailForReset = await findActiveInviteEmailForUser(tx, tenantId, appUserId)
    await revokeActiveMemberCodes(tx, tenantId, appUserId, 'CANCELED', nowIso, 'INVITE')

    if (profile.membershipStatus === 'PENDING' && profile.deletedAt === null) {
      await writeMaster(tx, { actorUserId: null }, async (w) => {
        await softDeleteAppUserAndOutlets(tx, w, appUserId, nowIso)
        return true
      })
    }

    await appendAudit(
      tx,
      {
        action: 'member.invite_canceled',
        entityType: 'app_user',
        entityId: appUserId,
        afterData: {
          operatorId: op.platformUserId,
          ...(emailForReset ? { email: emailForReset } : {}),
        },
        actorUserId: null,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )
  })

  if (emailForReset && tenantSlug) {
    await getLimiters().redeemEmail.reset(`${tenantSlug}:${emailForReset}`)
  }
}

export async function reissueOwnerInvite(
  op: PlatformOperatorActor,
  tenantId: string,
  appUserId: string,
  deps?: IdentityServiceDeps,
): Promise<ReissueInviteResult> {
  if (!isUuid(tenantId) || !isUuid(appUserId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid identifier')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()

  const res = await withTenant(tenantId, async (tx) => {
    const tenantRow = await findTenantDetailRow(tx, tenantId)
    if (!tenantRow) {
      throw new AppError('VALIDATION_FAILED', 'Tenant not found')
    }

    const profile = await findAppUserById(tx, tenantId, appUserId)
    if (!profile || profile.deletedAt !== null || profile.authUserId !== null) {
      throw new AppError('VALIDATION_FAILED', 'Invite cannot be reissued')
    }

    const latestInvite = await lockLatestInviteCodeForUser(tx, tenantId, appUserId)
    if (!latestInvite || latestInvite.usedAt !== null || latestInvite.revokedAt !== null) {
      throw new AppError('VALIDATION_FAILED', 'No active pending invite found')
    }

    const issued = await issueInviteCore(
      tx,
      {
        tenantId,
        appUserId,
        email: latestInvite.email,
        issuedBy: null,
        nowIso,
      },
      deps,
    )

    await appendAudit(
      tx,
      {
        action: 'member.invite_reissued',
        entityType: 'member_code',
        entityId: issued.codeId,
        beforeData: { codeId: latestInvite.id },
        afterData: {
          codeId: issued.codeId,
          email: latestInvite.email,
          operatorId: op.platformUserId,
        },
        actorUserId: null,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return {
      slug: tenantRow.slug,
      email: latestInvite.email,
      codeId: issued.codeId,
      code: issued.code,
      expiresAt: issued.expiresAt,
    }
  })

  await getLimiters().redeemEmail.reset(`${res.slug}:${res.email}`)
  return {
    codeId: res.codeId,
    code: res.code,
    expiresAt: res.expiresAt,
  }
}

/**
 * Operator-assisted password reset inside the context of a specific tenant.
 * Exempt from R1-R3 (may issue codes for Owners and multi-tenant accounts),
 * while strictly requiring active membership in `tenantId`.
 */
export async function issueResetCodeAsOperator(
  op: PlatformOperatorActor,
  input: { tenantId: string; appUserId: string },
  deps?: IdentityServiceDeps,
): Promise<{ codeId: string; code: string; expiresAt: string }> {
  if (!isUuid(input.tenantId) || !isUuid(input.appUserId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid identifier')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const expiresAt = addHoursIso(nowIso, RESET_TTL_HOURS)
  const generated = generateOneTimeMemberCode(deps)
  const codeId = identityIdGen.newId()

  const issued = await withTenant(input.tenantId, async (tx) => {
    const profile = await findAppUserById(tx, input.tenantId, input.appUserId)
    if (
      !profile ||
      profile.deletedAt !== null ||
      !profile.isActive ||
      profile.membershipStatus !== 'ACTIVE' ||
      !profile.authUserId
    ) {
      throw new AppError('VALIDATION_FAILED', 'Target user is not an active member of this tenant')
    }

    const email = await findAuthUserEmailById(tx, profile.authUserId)
    if (!email) {
      throw new AppError('VALIDATION_FAILED', 'Linked auth user not found')
    }

    await revokeActiveMemberCodes(tx, input.tenantId, profile.id, 'REPLACED', nowIso, 'RESET')
    await insertMemberCodeRow(tx, {
      id: codeId,
      tenantId: input.tenantId,
      appUserId: profile.id,
      kind: 'RESET',
      email,
      codeHash: generated.codeHash,
      expiresAt,
      issuedBy: null,
      createdAt: nowIso,
    })

    await appendAudit(
      tx,
      {
        action: 'member.reset_issued',
        entityType: 'member_code',
        entityId: codeId,
        afterData: {
          appUserId: profile.id,
          codeId,
          by: 'platform_operator',
          operatorId: op.platformUserId,
        },
        actorUserId: null,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return {
      emailHash: hashEmailShort(email),
      codeId,
      code: generated.formatted,
      expiresAt,
    }
  })

  log.info(
    {
      userId: op.platformUserId,
      tenantId: input.tenantId,
      usernameHash: issued.emailHash,
    },
    'operator issued password reset code',
  )

  return {
    codeId: issued.codeId,
    code: issued.code,
    expiresAt: issued.expiresAt,
  }
}
