import '@tanstack/react-start/server-only'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster, type MasterWriter } from '~/modules/sync/public'
import { withTenant, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { validatePin } from '../domain/pin-policy'
import {
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import { DEFAULT_ARGON2ID_PARAMS, deriveVerifier, generateSalt16, staffPinHash } from './kdf'
import { listMemberOutletAssignments, type MemberAssignmentDbRow } from './member-directory.repo'
import {
  findAppUserActiveForPin,
  findUserPinCredential,
  listActiveCredentialsForOutlet,
  listActiveDeviceIdsForUser,
  listExistingStaffPinsForUser,
  tombstoneStaffPinsByIds,
  upsertStaffPinRow,
  upsertUserPinCredential,
  type UserPinCredentialRow,
} from './pin.repo'

function nowIsoFrom(deps?: IdentityServiceDeps): string {
  return (deps?.nowIso ?? (() => new Date().toISOString()))()
}

function isMemberWithinActorScope(
  assignments: readonly Pick<MemberAssignmentDbRow, 'outletId'>[],
  actorOutletIds: readonly string[] | null | undefined,
): boolean {
  if (actorOutletIds === null) return true
  if (!Array.isArray(actorOutletIds) || actorOutletIds.length === 0) return false
  if (assignments.length === 0) return false
  const allowed = new Set(actorOutletIds)
  return assignments.every((a) => a.outletId !== null && allowed.has(a.outletId))
}

/**
 * Derives or updates `staff_pin` rows across all active devices in the user's assigned outlets,
 * and tombstones rows for any device no longer in scope (BR-AUT-003/004, FLOW-01/02).
 */
export async function deriveStaffPinsForUser(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    tenantId: string
    userId: string
    nowIso: string
    credential?: UserPinCredentialRow
  },
): Promise<void> {
  const cred = params.credential ?? (await findUserPinCredential(tx, params.tenantId, params.userId))
  const targetDeviceIds = cred
    ? await listActiveDeviceIdsForUser(tx, params.tenantId, params.userId)
    : []
  const targetSet = new Set(targetDeviceIds)

  const existing = await listExistingStaffPinsForUser(tx, params.tenantId, params.userId)
  const existingByDevice = new Map(existing.map((r) => [r.deviceId, r]))

  const toTombstone = existing
    .filter((r) => r.deletedAt === null && !targetSet.has(r.deviceId))
    .map((r) => r.id)

  await tombstoneStaffPinsByIds(tx, w, params.tenantId, toTombstone, params.nowIso)

  if (!cred) return

  for (const deviceId of targetDeviceIds) {
    const deviceSalt = generateSalt16()
    const pinHash = staffPinHash(deviceSalt, cred.verifier)
    await upsertStaffPinRow(tx, w, {
      id: existingByDevice.get(deviceId)?.id ?? identityIdGen.newId(),
      tenantId: params.tenantId,
      userId: params.userId,
      deviceId,
      deviceSalt,
      pinHash,
      kdfAlgo: cred.kdfAlgo,
      kdfParams: cred.kdfParams,
      kdfSalt: cred.kdfSalt,
      pinEpoch: cred.pinEpoch,
      nowIso: params.nowIso,
    })
  }
}

/**
 * Derives `staff_pin` entries for a newly enrolled active device across all ACTIVE
 * credentialed staff assigned to `outletId` (or tenant-wide `outlet_id IS NULL`).
 */
export async function deriveStaffPinsForDevice(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    tenantId: string
    deviceId: string
    outletId: string
    nowIso: string
    credentials?: readonly UserPinCredentialRow[]
  },
): Promise<void> {
  const creds =
    params.credentials ?? (await listActiveCredentialsForOutlet(tx, params.tenantId, params.outletId))
  for (const cred of creds) {
    const deviceSalt = generateSalt16()
    const pinHash = staffPinHash(deviceSalt, cred.verifier)
    await upsertStaffPinRow(tx, w, {
      id: identityIdGen.newId(),
      tenantId: params.tenantId,
      userId: cred.userId,
      deviceId: params.deviceId,
      deviceSalt,
      pinHash,
      kdfAlgo: cred.kdfAlgo,
      kdfParams: cred.kdfParams,
      kdfSalt: cred.kdfSalt,
      pinEpoch: cred.pinEpoch,
      nowIso: params.nowIso,
    })
  }
}

async function applySetOrResetPin(
  actor: IdentityAuthActor,
  input: { userId: string; pin: string },
  deps?: IdentityServiceDeps,
): Promise<{ userId: string; pinEpoch: number }> {
  requireActorPermission(actor, 'user.manage')

  const policy = validatePin(input.pin)
  if (!policy.ok) {
    const msgKey =
      policy.reason === 'WEAK'
        ? 'admin.users.pin.policyWeak'
        : policy.reason === 'NOT_DIGITS'
          ? 'admin.users.pin.policyDigits'
          : 'admin.users.pin.policyLength'
    throw new AppError('VALIDATION_FAILED', msgKey)
  }

  const nowIso = nowIsoFrom(deps)
  const kdfSalt = generateSalt16()
  const verifier = await deriveVerifier(input.pin, kdfSalt, DEFAULT_ARGON2ID_PARAMS, 'ARGON2ID')

  return withTenant(actor.tenantId, async (tx) => {
    const user = await findAppUserActiveForPin(tx, actor.tenantId, input.userId)
    if (!user || user.membershipStatus !== 'ACTIVE' || !user.isActive) {
      throw new AppError('VALIDATION_FAILED', 'Member not active')
    }

    const assignments = (await listMemberOutletAssignments(tx, actor.tenantId)).filter(
      (a) => a.userId === input.userId,
    )
    if (!isMemberWithinActorScope(assignments, actor.outletIds)) {
      throw new AppError('FORBIDDEN', 'Target member is outside your outlet scope')
    }

    const existing = await findUserPinCredential(tx, actor.tenantId, input.userId)
    const pinEpoch = (existing?.pinEpoch ?? 0) + 1

    await upsertUserPinCredential(tx, {
      tenantId: actor.tenantId,
      userId: input.userId,
      kdfAlgo: 'ARGON2ID',
      kdfParams: DEFAULT_ARGON2ID_PARAMS,
      kdfSalt,
      verifier,
      pinEpoch,
      pinSetAt: nowIso,
      pinSetBy: actor.appUserId,
    })

    const nextCred: UserPinCredentialRow = {
      userId: input.userId,
      tenantId: actor.tenantId,
      kdfAlgo: 'ARGON2ID',
      kdfParams: DEFAULT_ARGON2ID_PARAMS,
      kdfSalt,
      verifier,
      pinEpoch,
    }

    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await deriveStaffPinsForUser(tx, w, {
        tenantId: actor.tenantId,
        userId: input.userId,
        nowIso,
        credential: nextCred,
      })
      return true
    })

    await appendAudit(
      tx,
      {
        action: 'pin.reset',
        entityType: 'user_pin_credential',
        entityId: input.userId,
        beforeData: existing ? { epoch: existing.pinEpoch } : null,
        afterData: { epoch: pinEpoch },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return { userId: input.userId, pinEpoch }
  })
}

export async function setPin(
  actor: IdentityAuthActor,
  input: { userId: string; pin: string },
  deps?: IdentityServiceDeps,
): Promise<{ userId: string; pinEpoch: number }> {
  return applySetOrResetPin(actor, input, deps)
}

export async function resetPin(
  actor: IdentityAuthActor,
  input: { userId: string; pin: string },
  deps?: IdentityServiceDeps,
): Promise<{ userId: string; pinEpoch: number }> {
  return applySetOrResetPin(actor, input, deps)
}
