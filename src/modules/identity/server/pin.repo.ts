import '@tanstack/react-start/server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { device } from './device-schema'
import { staffPin, staffPinState, userPinCredential, type PinKdfParams } from './pin-schema'
import { appUser, cashMaster, userOutlet } from './schema'

export interface UserPinCredentialRow {
  userId: string
  tenantId: string
  kdfAlgo: 'ARGON2ID' | 'PBKDF2_SHA256'
  kdfParams: PinKdfParams
  kdfSalt: Buffer
  verifier: Buffer
  pinEpoch: number
}

export async function findAppUserActiveForPin(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<{ id: string; membershipStatus: string; isActive: boolean } | null> {
  const rows = await tx
    .select({
      id: appUser.id,
      membershipStatus: appUser.membershipStatus,
      isActive: appUser.isActive,
    })
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), eq(appUser.id, userId), isNull(appUser.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function findUserPinCredential(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<UserPinCredentialRow | null> {
  const rows = await tx
    .select({
      userId: userPinCredential.userId,
      tenantId: userPinCredential.tenantId,
      kdfAlgo: userPinCredential.kdfAlgo,
      kdfParams: userPinCredential.kdfParams,
      kdfSalt: userPinCredential.kdfSalt,
      verifier: userPinCredential.verifier,
      pinEpoch: userPinCredential.pinEpoch,
    })
    .from(userPinCredential)
    .where(and(eq(userPinCredential.tenantId, tenantId), eq(userPinCredential.userId, userId)))
    .limit(1)
  const r = rows[0]
  if (!r) return null
  return {
    ...r,
    kdfAlgo: r.kdfAlgo as 'ARGON2ID' | 'PBKDF2_SHA256',
  }
}

export async function upsertUserPinCredential(
  tx: TenantTx,
  input: {
    tenantId: string
    userId: string
    kdfAlgo: 'ARGON2ID' | 'PBKDF2_SHA256'
    kdfParams: PinKdfParams
    kdfSalt: Buffer
    verifier: Buffer
    pinEpoch: number
    pinSetAt: string
    pinSetBy: string
  },
): Promise<void> {
  await tx
    .insert(userPinCredential)
    .values({
      userId: input.userId,
      tenantId: input.tenantId,
      kdfAlgo: input.kdfAlgo,
      kdfParams: input.kdfParams,
      kdfSalt: input.kdfSalt,
      verifier: input.verifier,
      pinEpoch: input.pinEpoch,
      pinSetAt: input.pinSetAt,
      pinSetBy: input.pinSetBy,
    })
    .onConflictDoUpdate({
      target: userPinCredential.userId,
      set: {
        kdfAlgo: input.kdfAlgo,
        kdfParams: input.kdfParams,
        kdfSalt: input.kdfSalt,
        verifier: input.verifier,
        pinEpoch: input.pinEpoch,
        pinSetAt: input.pinSetAt,
        pinSetBy: input.pinSetBy,
      },
    })
}

export async function listActiveDeviceIdsForUser(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const res = await tx.execute(
    sql`SELECT DISTINCT d.id AS device_id
        FROM device d
        JOIN cash_master r
          ON r.tenant_id = d.tenant_id
         AND r.id = d.register_id
        JOIN app_user au
          ON au.tenant_id = d.tenant_id
         AND au.id = ${userId}::uuid
        JOIN user_outlet uo
          ON uo.tenant_id = d.tenant_id
         AND uo.user_id = au.id
        WHERE d.tenant_id = ${tenantId}::uuid
          AND d.revoked_at IS NULL
          AND r.deleted_at IS NULL
          AND r.status = 'ACTIVE'
          AND au.deleted_at IS NULL
          AND au.membership_status = 'ACTIVE'
          AND au.is_active = true
          AND uo.deleted_at IS NULL
          AND (uo.outlet_id IS NULL OR uo.outlet_id = r.outlet_id)`,
  )
  return res.rows.map((r) => String((r as { device_id: unknown }).device_id))
}

export async function listActiveCredentialsForOutlet(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
): Promise<UserPinCredentialRow[]> {
  const res = await tx.execute(
    sql`SELECT DISTINCT c.user_id, c.tenant_id, c.kdf_algo, c.kdf_params, c.kdf_salt, c.verifier, c.pin_epoch
        FROM user_pin_credential c
        JOIN app_user au
          ON au.tenant_id = c.tenant_id
         AND au.id = c.user_id
        JOIN user_outlet uo
          ON uo.tenant_id = c.tenant_id
         AND uo.user_id = c.user_id
        WHERE c.tenant_id = ${tenantId}::uuid
          AND au.deleted_at IS NULL
          AND au.membership_status = 'ACTIVE'
          AND au.is_active = true
          AND uo.deleted_at IS NULL
          AND (uo.outlet_id IS NULL OR uo.outlet_id = ${outletId}::uuid)`,
  )
  return res.rows.map((row) => {
    const r = row as {
      user_id: string
      tenant_id: string
      kdf_algo: 'ARGON2ID' | 'PBKDF2_SHA256'
      kdf_params: PinKdfParams
      kdf_salt: Buffer
      verifier: Buffer
      pin_epoch: number
    }
    return {
      userId: String(r.user_id),
      tenantId: String(r.tenant_id),
      kdfAlgo: r.kdf_algo,
      kdfParams: r.kdf_params,
      kdfSalt: Buffer.isBuffer(r.kdf_salt) ? r.kdf_salt : Buffer.from(r.kdf_salt),
      verifier: Buffer.isBuffer(r.verifier) ? r.verifier : Buffer.from(r.verifier),
      pinEpoch: Number(r.pin_epoch),
    }
  })
}

export async function listExistingStaffPinsForUser(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<Array<{ id: string; deviceId: string; deletedAt: string | null }>> {
  return tx
    .select({
      id: staffPin.id,
      deviceId: staffPin.deviceId,
      deletedAt: staffPin.deletedAt,
    })
    .from(staffPin)
    .where(and(eq(staffPin.tenantId, tenantId), eq(staffPin.userId, userId)))
}

export async function listActiveStaffPinDeviceIds(
  tx: TenantTx,
  tenantId: string,
  deviceId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: staffPin.id })
    .from(staffPin)
    .where(
      and(
        eq(staffPin.tenantId, tenantId),
        eq(staffPin.deviceId, deviceId),
        isNull(staffPin.deletedAt),
      ),
    )
  return rows.map((r) => r.id)
}

export async function upsertStaffPinRow(
  tx: TenantTx,
  w: MasterWriter,
  input: {
    id: string
    tenantId: string
    userId: string
    deviceId: string
    deviceSalt: Buffer
    pinHash: Buffer
    kdfAlgo: 'ARGON2ID' | 'PBKDF2_SHA256'
    kdfParams: PinKdfParams
    kdfSalt: Buffer
    pinEpoch: number
    nowIso: string
  },
): Promise<void> {
  await tx
    .insert(staffPin)
    .values({
      id: input.id,
      tenantId: input.tenantId,
      version: w.version,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
      deletedAt: null,
      userId: input.userId,
      deviceId: input.deviceId,
      deviceSalt: input.deviceSalt,
      pinHash: input.pinHash,
      kdfAlgo: input.kdfAlgo,
      kdfParams: input.kdfParams,
      kdfSalt: input.kdfSalt,
      pinEpoch: input.pinEpoch,
    })
    .onConflictDoUpdate({
      target: [staffPin.userId, staffPin.deviceId],
      set: {
        version: w.version,
        updatedAt: input.nowIso,
        updatedBy: w.actorUserId,
        deletedAt: null,
        deviceSalt: input.deviceSalt,
        pinHash: input.pinHash,
        kdfAlgo: input.kdfAlgo,
        kdfParams: input.kdfParams,
        kdfSalt: input.kdfSalt,
        pinEpoch: input.pinEpoch,
      },
    })
}

export async function tombstoneStaffPinsByIds(
  tx: TenantTx,
  w: MasterWriter,
  tenantId: string,
  ids: readonly string[],
  nowIso: string,
): Promise<void> {
  if (ids.length === 0) return
  await tx
    .update(staffPin)
    .set({
      deletedAt: nowIso,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
      version: w.version,
    })
    .where(and(eq(staffPin.tenantId, tenantId), inArray(staffPin.id, [...ids]), isNull(staffPin.deletedAt)))
}

export async function tombstoneStaffPinsByUser(
  tx: TenantTx,
  w: MasterWriter,
  tenantId: string,
  userId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(staffPin)
    .set({
      deletedAt: nowIso,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
      version: w.version,
    })
    .where(
      and(eq(staffPin.tenantId, tenantId), eq(staffPin.userId, userId), isNull(staffPin.deletedAt)),
    )
}

export async function tombstoneStaffPinsByDevice(
  tx: TenantTx,
  w: MasterWriter,
  tenantId: string,
  deviceId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(staffPin)
    .set({
      deletedAt: nowIso,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
      version: w.version,
    })
    .where(
      and(
        eq(staffPin.tenantId, tenantId),
        eq(staffPin.deviceId, deviceId),
        isNull(staffPin.deletedAt),
      ),
    )
}

/**
 * Queries real `pinStatus` per member:
 * - `unset`: no `user_pin_credential` row
 * - `locked`: at least one active device reports `lock_tier = 3` at the current `pin_epoch`
 * - `active`: credential exists and not currently locked at the current epoch
 */
export async function listPinStatusesForTenant(
  tx: TenantTx,
  tenantId: string,
  appUserId?: string,
): Promise<Map<string, 'unset' | 'active' | 'locked'>> {
  const creds = await tx
    .select({ userId: userPinCredential.userId, pinEpoch: userPinCredential.pinEpoch })
    .from(userPinCredential)
    .where(
      and(
        eq(userPinCredential.tenantId, tenantId),
        appUserId ? eq(userPinCredential.userId, appUserId) : undefined,
      ),
    )

  const epochByUser = new Map<string, number>()
  for (const c of creds) {
    epochByUser.set(c.userId, c.pinEpoch)
  }

  const lockedStates = await tx
    .select({
      userId: staffPinState.userId,
      pinEpochSeen: staffPinState.pinEpochSeen,
    })
    .from(staffPinState)
    .where(
      and(
        eq(staffPinState.tenantId, tenantId),
        eq(staffPinState.lockTier, 3),
        appUserId ? eq(staffPinState.userId, appUserId) : undefined,
      ),
    )

  const lockedUsers = new Set<string>()
  for (const s of lockedStates) {
    const currentEpoch = epochByUser.get(s.userId)
    if (currentEpoch !== undefined && s.pinEpochSeen >= currentEpoch) {
      lockedUsers.add(s.userId)
    }
  }

  const result = new Map<string, 'unset' | 'active' | 'locked'>()
  for (const userId of epochByUser.keys()) {
    result.set(userId, lockedUsers.has(userId) ? 'locked' : 'active')
  }
  return result
}

export async function upsertStaffPinStateMonotonic(
  tx: TenantTx,
  input: {
    userId: string
    deviceId: string
    tenantId: string
    failedCount: number
    lockTier: number
    lockedUntil: string | null
    lastFailedAt: string | null
    pinEpochSeen: number
    reportedAt: string
    deviceSeq: number
  },
): Promise<{ applied: boolean }> {
  const res = await tx.execute(
    sql`INSERT INTO staff_pin_state (
          user_id, device_id, tenant_id, failed_count, lock_tier,
          locked_until, last_failed_at, pin_epoch_seen, reported_at, last_device_seq
        )
        VALUES (
          ${input.userId}::uuid,
          ${input.deviceId}::uuid,
          ${input.tenantId}::uuid,
          ${input.failedCount},
          ${input.lockTier},
          ${input.lockedUntil}::timestamptz,
          ${input.lastFailedAt}::timestamptz,
          ${input.pinEpochSeen},
          ${input.reportedAt}::timestamptz,
          ${input.deviceSeq}
        )
        ON CONFLICT (user_id, device_id) DO UPDATE
        SET failed_count = EXCLUDED.failed_count,
            lock_tier = EXCLUDED.lock_tier,
            locked_until = EXCLUDED.locked_until,
            last_failed_at = EXCLUDED.last_failed_at,
            pin_epoch_seen = EXCLUDED.pin_epoch_seen,
            reported_at = EXCLUDED.reported_at,
            last_device_seq = EXCLUDED.last_device_seq
        WHERE staff_pin_state.last_device_seq < EXCLUDED.last_device_seq
        RETURNING user_id`,
  )
  return { applied: res.rows.length > 0 }
}

// Keep unused imports clean: touch schema references used only in joins via raw/typed queries
void device
void cashMaster
void userOutlet
