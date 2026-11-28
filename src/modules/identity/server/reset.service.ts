import '@tanstack/react-start/server-only'
import { isUuid } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { withTenant } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { OWNER_ROLE_CODE } from '../domain/default-roles'
import { findAuthUserEmailById } from './auth-account.repo'
import {
  addHoursIso,
  generateOneTimeMemberCode,
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import { assertActorMayActOnMember } from './member-act-guard'
import {
  callAuthAccountMembershipCount,
  findAppUserById,
  insertMemberCodeRow,
  revokeActiveMemberCodes,
} from './member-code.repo'
import { listActiveRolesOfUser } from './member-directory.repo'

const RESET_TTL_HOURS = 24

export interface IssueResetCodeResult {
  codeId: string
  code: string
  expiresAt: string
}

/**
 * Issues a 24-hour password reset code subject to R1-R4:
 * active member in this tenant, linked to a global auth account, non-OWNER role,
 * and `auth_account_membership_count(auth_user_id) === 1`.
 * Fails uniformly with FORBIDDEN (`members.reset.unavailable`) to avoid leaking
 * multi-tenant membership state.
 */
export async function issueResetCode(
  actor: IdentityAuthActor,
  appUserId: string,
  deps?: IdentityServiceDeps,
): Promise<IssueResetCodeResult> {
  requireActorPermission(actor, 'user.reset_password')
  if (!isUuid(appUserId)) {
    throw new AppError('FORBIDDEN', 'members.reset.unavailable')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const expiresAt = addHoursIso(nowIso, RESET_TTL_HOURS)
  const generated = generateOneTimeMemberCode(deps)
  const codeId = identityIdGen.newId()

  return withTenant(actor.tenantId, async (tx) => {
    const profile = await findAppUserById(tx, actor.tenantId, appUserId)
    if (
      !profile ||
      profile.deletedAt !== null ||
      !profile.isActive ||
      profile.membershipStatus !== 'ACTIVE' ||
      !profile.authUserId
    ) {
      throw new AppError('FORBIDDEN', 'members.reset.unavailable')
    }

    await assertActorMayActOnMember(tx, actor, appUserId)

    const roles = await listActiveRolesOfUser(tx, actor.tenantId, appUserId)
    if (roles.some((r) => r.roleCode === OWNER_ROLE_CODE)) {
      throw new AppError('FORBIDDEN', 'members.reset.unavailable')
    }

    const membershipCount = await callAuthAccountMembershipCount(tx, profile.authUserId)
    if (membershipCount !== 1) {
      throw new AppError('FORBIDDEN', 'members.reset.unavailable')
    }

    const email = await findAuthUserEmailById(tx, profile.authUserId)
    if (!email) {
      throw new AppError('FORBIDDEN', 'members.reset.unavailable')
    }

    await revokeActiveMemberCodes(tx, actor.tenantId, appUserId, 'REPLACED', nowIso, 'RESET')
    await insertMemberCodeRow(tx, {
      id: codeId,
      tenantId: actor.tenantId,
      appUserId,
      kind: 'RESET',
      email,
      codeHash: generated.codeHash,
      expiresAt,
      issuedBy: actor.appUserId,
      createdAt: nowIso,
    })

    await appendAudit(
      tx,
      {
        action: 'member.reset_issued',
        entityType: 'member_code',
        entityId: codeId,
        afterData: { appUserId, codeId, expiresAt },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return {
      codeId,
      code: generated.formatted,
      expiresAt,
    }
  })
}
