import '@tanstack/react-start/server-only'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import {
  changeMemberRoleAndOutletsSchema,
  type ChangeMemberRoleAndOutletsInput,
  type MemberDirectoryView,
} from '../shared'
import {
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import { bumpAppUserVersion, countActiveOwnersExcluding } from './member-code.repo'
import {
  findActiveMemberTarget,
  listActorRoleCodes,
  listMemberAppUsers,
  listMemberEmailsViaDefiner,
  listMemberOutletAssignments,
  listOutletsByIds,
  listPendingInviteEmailsForUsers,
  listRolesByIds,
  replaceUserOutlets,
  type MemberAssignmentDbRow,
} from './member-directory.repo'
import { listPinStatusesForTenant } from './pin.repo'
import { deriveStaffPinsForUser } from './pin.service'

export interface ListMembersFilter {
  search?: string
  roleId?: string
  outletId?: string
}

function nowIsoFrom(deps?: IdentityServiceDeps): string {
  return (deps?.nowIso ?? (() => new Date().toISOString()))()
}

function isMemberWithinActorScope(
  assignments: readonly Pick<MemberAssignmentDbRow, 'outletId'>[],
  actorOutletIds: readonly string[] | null | undefined,
): boolean {
  if (actorOutletIds === null) {
    return true
  }
  if (!Array.isArray(actorOutletIds) || actorOutletIds.length === 0) {
    return false
  }
  if (assignments.length === 0) {
    return false
  }
  const allowed = new Set(actorOutletIds)
  return assignments.every((a) => a.outletId !== null && allowed.has(a.outletId))
}

export async function listMembers(
  actor: IdentityAuthActor,
  filter?: ListMembersFilter,
): Promise<MemberDirectoryView[]> {
  requireActorPermission(actor, 'user.manage')
  const searchTerm = filter?.search?.trim().toLowerCase() || ''

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const users = await listMemberAppUsers(tx, actor.tenantId)
    const activeEmails = await listMemberEmailsViaDefiner(tx)
    const pendingUserIds = users.filter((u) => u.membershipStatus === 'PENDING').map((u) => u.id)
    const pendingEmails = await listPendingInviteEmailsForUsers(tx, actor.tenantId, pendingUserIds)
    const allAssignments = await listMemberOutletAssignments(tx, actor.tenantId)
    const pinStatuses = await listPinStatusesForTenant(tx, actor.tenantId)

    const assignmentsByUser = new Map<string, MemberAssignmentDbRow[]>()
    for (const row of allAssignments) {
      const list = assignmentsByUser.get(row.userId) ?? []
      list.push(row)
      assignmentsByUser.set(row.userId, list)
    }

    const results: MemberDirectoryView[] = []
    for (const user of users) {
      const memberAssignments = assignmentsByUser.get(user.id) ?? []
      if (!isMemberWithinActorScope(memberAssignments, actor.outletIds)) {
        continue
      }

      if (filter?.roleId && !memberAssignments.some((a) => a.roleId === filter.roleId)) {
        continue
      }
      if (filter?.outletId && !memberAssignments.some((a) => a.outletId === filter.outletId)) {
        continue
      }

      const email =
        user.membershipStatus === 'ACTIVE'
          ? (activeEmails.get(user.id) ?? null)
          : (pendingEmails.get(user.id) ?? null)

      if (searchTerm) {
        const nameMatch = user.displayName.toLowerCase().includes(searchTerm)
        const emailMatch = email ? email.toLowerCase().includes(searchTerm) : false
        if (!nameMatch && !emailMatch) {
          continue
        }
      }

      results.push({
        appUserId: user.id,
        displayName: user.displayName,
        email,
        membershipStatus: user.membershipStatus === 'PENDING' ? 'PENDING' : 'ACTIVE',
        isActive: user.isActive,
        pinStatus: pinStatuses.get(user.id) ?? 'unset',
        assignments: memberAssignments.map((a) => ({
          outletId: a.outletId,
          outletCode: a.outletCode,
          outletName: a.outletName,
          roleId: a.roleId,
          roleCode: a.roleCode,
          roleName: a.roleName,
        })),
      })
    }

    return results
  })
}

export async function changeMemberRoleAndOutlets(
  actor: IdentityAuthActor,
  rawInput: ChangeMemberRoleAndOutletsInput,
  deps?: IdentityServiceDeps,
): Promise<MemberDirectoryView> {
  requireActorPermission(actor, 'user.manage')
  const parsedRes = changeMemberRoleAndOutletsSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid member assignment input',
    )
  }
  const parsed = parsedRes.data
  const nowIso = nowIsoFrom(deps)

  // Reject duplicate outlet keys so intent is unambiguous.
  const seenOutletKeys = new Set<string>()
  for (const a of parsed.assignments) {
    const key = a.outletId ?? '__ALL__'
    if (seenOutletKeys.has(key)) {
      throw new AppError('VALIDATION_FAILED', 'Duplicate outlet assignment')
    }
    seenOutletKeys.add(key)
  }

  return withTenant(actor.tenantId, async (tx) => {
    const target = await findActiveMemberTarget(tx, actor.tenantId, parsed.appUserId)
    if (!target) {
      throw new AppError('VALIDATION_FAILED', 'Member not found')
    }

    const allAssignments = await listMemberOutletAssignments(tx, actor.tenantId)
    const currentAssignments = allAssignments.filter((a) => a.userId === parsed.appUserId)

    if (!isMemberWithinActorScope(currentAssignments, actor.outletIds)) {
      throw new AppError('FORBIDDEN', 'Target member is outside your outlet scope')
    }
    if (!isMemberWithinActorScope(parsed.assignments, actor.outletIds)) {
      throw new AppError('FORBIDDEN', 'Requested outlet assignment is outside your scope')
    }

    const requestedRoleIds = Array.from(new Set(parsed.assignments.map((a) => a.roleId)))
    const roleRows = await listRolesByIds(tx, actor.tenantId, requestedRoleIds)
    if (roleRows.length !== requestedRoleIds.length) {
      throw new AppError('VALIDATION_FAILED', 'Invalid role id')
    }
    const roleCodeById = new Map(roleRows.map((r) => [r.id, r.code]))

    const requestedOutletIds = Array.from(
      new Set(parsed.assignments.map((a) => a.outletId).filter((id): id is string => id !== null)),
    )
    if (requestedOutletIds.length > 0) {
      const outletRows = await listOutletsByIds(tx, actor.tenantId, requestedOutletIds)
      if (outletRows.length !== requestedOutletIds.length) {
        throw new AppError('VALIDATION_FAILED', 'Invalid outlet id')
      }
    }

    const targetCurrentlyHasOwner = currentAssignments.some((a) => a.roleCode === 'OWNER')
    const targetWillHaveOwner = parsed.assignments.some(
      (a) => roleCodeById.get(a.roleId) === 'OWNER',
    )

    if (targetCurrentlyHasOwner || targetWillHaveOwner) {
      const actorRoles = await listActorRoleCodes(tx, actor.tenantId, actor.appUserId)
      if (!actorRoles.includes('OWNER')) {
        throw new AppError('FORBIDDEN', 'Only Owner can assign or modify the Owner role')
      }
    }

    if (targetCurrentlyHasOwner && !targetWillHaveOwner) {
      const remainingOwners = await countActiveOwnersExcluding(
        tx,
        actor.tenantId,
        parsed.appUserId,
      )
      if (remainingOwners < 1) {
        throw new AppError('VALIDATION_FAILED', 'admin.users.lastOwner')
      }
    }

    const { result: diff } = await writeMaster(
      tx,
      { actorUserId: actor.appUserId },
      async (w) => {
        const res = await replaceUserOutlets(tx, w, {
          appUserId: parsed.appUserId,
          assignments: parsed.assignments,
          newId: () => identityIdGen.newId(),
          nowIso,
        })
        await bumpAppUserVersion(tx, w, parsed.appUserId, nowIso)
        await deriveStaffPinsForUser(tx, w, {
          tenantId: actor.tenantId,
          userId: parsed.appUserId,
          nowIso,
        })
        return res
      },
    )

    await appendAudit(
      tx,
      {
        action: 'user.changed',
        entityType: 'app_user',
        entityId: parsed.appUserId,
        beforeData: { assignments: diff.before },
        afterData: { assignments: diff.after },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    const updatedUsers = await listMemberAppUsers(tx, actor.tenantId)
    const updatedUser = updatedUsers.find((u) => u.id === parsed.appUserId)
    const updatedAssignments = (await listMemberOutletAssignments(tx, actor.tenantId)).filter(
      (a) => a.userId === parsed.appUserId,
    )
    const activeEmails = await listMemberEmailsViaDefiner(tx)
    const pendingEmails =
      updatedUser?.membershipStatus === 'PENDING'
        ? await listPendingInviteEmailsForUsers(tx, actor.tenantId, [parsed.appUserId])
        : new Map<string, string>()

    const pinStatuses = await listPinStatusesForTenant(tx, actor.tenantId)

    return {
      appUserId: parsed.appUserId,
      displayName: updatedUser?.displayName ?? '',
      email:
        updatedUser?.membershipStatus === 'PENDING'
          ? (pendingEmails.get(parsed.appUserId) ?? null)
          : (activeEmails.get(parsed.appUserId) ?? null),
      membershipStatus: updatedUser?.membershipStatus === 'PENDING' ? 'PENDING' : 'ACTIVE',
      isActive: updatedUser?.isActive ?? true,
      pinStatus: pinStatuses.get(parsed.appUserId) ?? 'unset',
      assignments: updatedAssignments.map((a) => ({
        outletId: a.outletId,
        outletCode: a.outletCode,
        outletName: a.outletName,
        roleId: a.roleId,
        roleCode: a.roleCode,
        roleName: a.roleName,
      })),
    }
  })
}
