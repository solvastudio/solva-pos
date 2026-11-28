import '@tanstack/react-start/server-only'
import { isUuid } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { OWNER_ROLE_CODE } from '../domain/default-roles'
import { deleteOrgMemberRow, deleteTenantOrgSessions } from './auth-account.repo'
import {
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import { assertActorMayActOnMember } from './member-act-guard'
import {
  countActiveOwnersExcluding,
  findAppUserById,
  revokeActiveMemberCodes,
  softDeleteAppUserAndOutlets,
} from './member-code.repo'
import { listActiveRolesOfUser } from './member-directory.repo'
import { tombstoneStaffPinsByUser } from './pin.repo'

export async function removeMember(
  actor: IdentityAuthActor,
  appUserId: string,
  deps?: IdentityServiceDeps,
): Promise<void> {
  requireActorPermission(actor, 'user.remove')
  if (!isUuid(appUserId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid user id')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()

  await withTenant(actor.tenantId, async (tx) => {
    const profile = await findAppUserById(tx, actor.tenantId, appUserId)
    if (!profile || profile.deletedAt !== null) {
      return
    }

    await assertActorMayActOnMember(tx, actor, appUserId)

    const roles = await listActiveRolesOfUser(tx, actor.tenantId, appUserId)
    if (roles.some((r) => r.roleCode === OWNER_ROLE_CODE)) {
      const remainingOwners = await countActiveOwnersExcluding(tx, actor.tenantId, appUserId)
      if (remainingOwners < 1) {
        throw new AppError('VALIDATION_FAILED', 'member.remove.lastOwner')
      }
    }

    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await softDeleteAppUserAndOutlets(tx, w, appUserId, nowIso)
      await tombstoneStaffPinsByUser(tx, w, actor.tenantId, appUserId, nowIso)
      return true
    })

    await revokeActiveMemberCodes(tx, actor.tenantId, appUserId, 'CANCELED', nowIso)

    if (profile.authUserId) {
      await deleteOrgMemberRow(tx, actor.authOrgId, profile.authUserId)
      await deleteTenantOrgSessions(tx, actor.authOrgId, profile.authUserId)
    }

    await appendAudit(
      tx,
      {
        action: 'member.removed',
        entityType: 'app_user',
        entityId: appUserId,
        beforeData: {
          displayName: profile.displayName,
          membershipStatus: profile.membershipStatus,
          hadAuthUser: Boolean(profile.authUserId),
        },
        afterData: {
          isActive: false,
        },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )
  })
}
