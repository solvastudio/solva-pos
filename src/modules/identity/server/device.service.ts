import '@tanstack/react-start/server-only'
import { randomBytes } from 'node:crypto'
import { EnrollRequest, type EnrollResponse } from '~/lib/contracts'
import {
  CODE_LENGTH_PAIRING,
  formatCode,
  generateCode,
  isUuid,
  normalizeCode,
  normalizeSlug,
} from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { getLimiters } from '~/server/auth/rate-limit/limiters'
import { withTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { getPublicBaseUrl } from '~/server/env'
import { AppError } from '~/server/error-classify'
import { createLogger } from '~/server/log'
import { getContext } from '~/server/logging/log-context'
import { nowIsoFrom } from '~/server/service-deps'
import {
  hashMemberCode,
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import {
  atomicClaimPairingCode,
  deleteUnusedPairingCodesForRegister,
  extendDeviceCredentialIfBelowThreshold,
  findActiveDeviceForRegister,
  findDeviceForRevoke,
  findRegisterWithOutletForDevice,
  findTenantEnrollMeta,
  insertDeviceAndSyncStatus,
  insertPairingCodeRow,
  listDevicesWithSyncStatusRows,
  markDeviceRevoked,
} from './device.repo'
import {
  hashDeviceCredential,
  invalidateDeviceAuthCacheByDeviceId,
  invalidateDeviceAuthCacheByHash,
  RateLimitRejectedError,
} from './device-auth'
import { getEnrollmentCounterProvider } from './enrollment-counters.port'
import {
  listActiveCredentialsForOutlet,
  listActiveStaffPinDeviceIds,
  tombstoneStaffPinsByDevice,
} from './pin.repo'
import { deriveStaffPinsForDevice } from './pin.service'
import {
  revokeDeviceSchema,
  type CreatePairingCodeResult,
  type DeviceRevokeReason,
  type DeviceStoragePersist,
  type DeviceView,
} from '../shared'
import { resolveTenantBySlug } from './tenant-resolver.service'

const log = createLogger('identity.device')

const PAIRING_TTL_MS = 15 * 60_000
const CREDENTIAL_TTL_MS = 180 * 86_400_000
const CREDENTIAL_RENEW_THRESHOLD_MS = 150 * 86_400_000
const DEFAULT_ENROLL_MIN_MS = 60

export type EnrollConflictReason = 'REGISTER_INACTIVE' | 'REGISTER_HAS_ACTIVE_DEVICE'

export class EnrollConflictError extends Error {
  readonly reason: EnrollConflictReason

  constructor(reason: EnrollConflictReason) {
    super(reason)
    this.name = 'EnrollConflictError'
    this.reason = reason
  }
}

export interface CreatePairingCodeDeps extends IdentityServiceDeps {
  publicBaseUrl?: string
}

export interface EnrollDeviceDeps {
  nowIso?: () => string
  minDelayMs?: number
  requestRef?: string
  tokenBytes?: Uint8Array
}

async function ensureMinDuration(startedAt: number, minMs: number): Promise<void> {
  if (minMs <= 0) return
  for (;;) {
    const remaining = minMs - (performance.now() - startedAt)
    if (remaining <= 0) return
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(remaining)))
  }
}

export async function createPairingCode(
  actor: IdentityAuthActor,
  registerId: string,
  deps?: CreatePairingCodeDeps,
): Promise<CreatePairingCodeResult> {
  if (!isUuid(registerId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid register id')
  }
  requireActorPermission(actor, 'user.manage')

  const nowIso = nowIsoFrom(deps)
  const nowMs = Date.parse(nowIso)

  const rateDecision = await getLimiters().issueTenant.consume(actor.tenantId, nowMs)
  if (!rateDecision.allowed) {
    throw new RateLimitRejectedError(rateDecision.retryAfterMs, 'interactive')
  }

  const bytes = deps?.randomCodeBytes
    ? deps.randomCodeBytes(CODE_LENGTH_PAIRING)
    : randomBytes(CODE_LENGTH_PAIRING)
  const plain = generateCode(bytes, CODE_LENGTH_PAIRING)
  const formattedCode = formatCode(plain)
  const codeHash = hashMemberCode(normalizeCode(plain))
  const expiresAt = new Date(nowMs + PAIRING_TTL_MS).toISOString()

  await withTenant(actor.tenantId, async (tx) => {
    const reg = await findRegisterWithOutletForDevice(tx, actor.tenantId, registerId)
    if (!reg) {
      throw new AppError('VALIDATION_FAILED', 'Register not found')
    }
    requireActorPermission(actor, 'user.manage', { outletId: reg.outletId })

    if (reg.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_FAILED', 'admin.devices.registerInactive')
    }

    await deleteUnusedPairingCodesForRegister(tx, actor.tenantId, registerId)
    await insertPairingCodeRow(tx, {
      id: identityIdGen.newId(),
      tenantId: actor.tenantId,
      registerId,
      codeHash,
      expiresAt,
      createdBy: actor.appUserId,
      createdAt: nowIso,
    })
  })

  const rawBaseUrl = (deps?.publicBaseUrl ?? getPublicBaseUrl()).replace(/\/+$/, '')
  const posBaseUrl = `${rawBaseUrl}/${actor.tenantSlug}/pos`
  const enrollUrl = `${posBaseUrl}#pair=${formattedCode}`

  log.info({ tenantId: actor.tenantId, registerId }, 'pairing code created')

  return {
    code: formattedCode,
    expiresAt,
    enrollUrl,
    baseUrl: posBaseUrl,
  }
}

export async function enrollDevice(
  rawInput: unknown,
  ip: string,
  deps?: EnrollDeviceDeps,
): Promise<EnrollResponse> {
  const startedAt = performance.now()
  const minDelayMs = deps?.minDelayMs ?? DEFAULT_ENROLL_MIN_MS
  const nowIso = nowIsoFrom(deps)
  const nowMs = Date.parse(nowIso)

  const parsedInput = EnrollRequest.safeParse(rawInput)
  if (!parsedInput.success) {
    await ensureMinDuration(startedAt, minDelayMs)
    throw new AppError('VALIDATION_FAILED', 'sys.code.invalid')
  }

  const slug = normalizeSlug(parsedInput.data.slug)
  const normalizedCode = normalizeCode(parsedInput.data.code)

  const limiters = getLimiters()
  const [ipDecision, slugDecision] = await Promise.all([
    limiters.enrollIp.consume(ip, nowMs),
    limiters.enrollSlug.consume(slug, nowMs),
  ])
  if (!ipDecision.allowed || !slugDecision.allowed) {
    const retryAfterMs = Math.max(
      ipDecision.allowed ? 0 : ipDecision.retryAfterMs,
      slugDecision.allowed ? 0 : slugDecision.retryAfterMs,
    )
    throw new RateLimitRejectedError(retryAfterMs, 'interactive')
  }

  const resolved = await resolveTenantBySlug(slug)
  if (resolved && resolved.status !== 'ACTIVE') {
    throw new AppError('TENANT_SUSPENDED', 'Tenant is suspended')
  }
  if (!resolved || normalizedCode.length !== CODE_LENGTH_PAIRING) {
    await ensureMinDuration(startedAt, minDelayMs)
    throw new AppError('VALIDATION_FAILED', 'sys.code.invalid')
  }

  const codeHash = hashMemberCode(normalizedCode)
  const tokenBuf = deps?.tokenBytes ?? randomBytes(32)
  const credential = tokenBuf.toString('base64url')
  const credentialHash = hashDeviceCredential(credential)
  const credentialExpiresAt = new Date(nowMs + CREDENTIAL_TTL_MS).toISOString()
  const deviceId = identityIdGen.newId()
  const userAgent = parsedInput.data.user_agent?.trim() || null

  try {
    return await withTenant(resolved.tenantId, async (tx) => {
      const claimed = await atomicClaimPairingCode(tx, resolved.tenantId, codeHash, nowIso)
      if (!claimed) {
        throw new AppError('VALIDATION_FAILED', 'sys.code.invalid')
      }

      const reg = await findRegisterWithOutletForDevice(tx, resolved.tenantId, claimed.registerId)
      if (!reg || reg.status !== 'ACTIVE') {
        throw new EnrollConflictError('REGISTER_INACTIVE')
      }

      const activeDev = await findActiveDeviceForRegister(tx, resolved.tenantId, reg.id)
      if (activeDev) {
        throw new EnrollConflictError('REGISTER_HAS_ACTIVE_DEVICE')
      }

      try {
        await insertDeviceAndSyncStatus(tx, {
          deviceId,
          tenantId: resolved.tenantId,
          registerId: reg.id,
          name: parsedInput.data.device_name,
          credentialHash,
          credentialIssuedAt: nowIso,
          credentialExpiresAt,
          pairingCodeId: claimed.id,
          userAgent,
          enrolledAt: nowIso,
          enrolledBy: claimed.createdBy,
        })
      } catch (err: unknown) {
        const pgErr = err as { code?: string; constraint?: string } | null
        if (pgErr?.code === '23505' && pgErr.constraint === 'uq_device__active_register') {
          throw new EnrollConflictError('REGISTER_HAS_ACTIVE_DEVICE')
        }
        throw err
      }

      const tenantMeta = await findTenantEnrollMeta(tx, resolved.tenantId)
      if (!tenantMeta) {
        throw new AppError('INTERNAL_ERROR', 'Missing tenant metadata during enrollment')
      }

      await appendAudit(
        tx,
        {
          action: 'device.enrolled',
          entityType: 'device',
          entityId: deviceId,
          outletId: reg.outletId,
          registerId: reg.id,
          deviceId,
          actorUserId: claimed.createdBy,
          requestRef: deps?.requestRef ?? getContext()?.reqId ?? null,
          occurredAt: nowIso,
          afterData: {
            deviceName: parsedInput.data.device_name,
            registerCode: reg.code,
          },
        },
        { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
      )

      const invoiceCounters = await getEnrollmentCounterProvider().getCountersAndBindDevice(
        tx,
        resolved.tenantId,
        reg.id,
        deviceId,
      )

      const pinCreds = await listActiveCredentialsForOutlet(tx, resolved.tenantId, reg.outletId)
      if (pinCreds.length > 0) {
        await writeMaster(tx, { actorUserId: claimed.createdBy }, async (w) => {
          await deriveStaffPinsForDevice(tx, w, {
            tenantId: resolved.tenantId,
            deviceId,
            outletId: reg.outletId,
            nowIso,
            credentials: pinCreds,
          })
          return true
        })
      }

      log.info(
        {
          tenantId: resolved.tenantId,
          deviceId,
          registerId: reg.id,
        },
        'device enrolled',
      )

      return {
        device_id: deviceId,
        credential,
        credential_expires_at: credentialExpiresAt,
        tenant: {
          id: tenantMeta.id,
          slug: tenantMeta.slug,
          name: tenantMeta.name,
          default_locale: tenantMeta.defaultLocale === 'en-US' ? 'en-US' : 'id-ID',
        },
        outlet: {
          id: reg.outletId,
          code: reg.outletCode,
          name: reg.outletName,
          timezone: reg.outletTimezone,
          day_cutoff_time: reg.outletDayCutoffTime.slice(0, 5),
        },
        register: {
          id: reg.id,
          code: reg.code,
          name: reg.name,
          register_type: reg.registerType === 'WAITER' ? 'WAITER' : 'CASHIER',
          paper_width_mm: reg.paperWidthMm === 58 ? 58 : 80,
        },
        server_time: nowMs,
        invoice_counters: invoiceCounters,
      }
    })
  } catch (err: unknown) {
    if (err instanceof AppError && err.code === 'VALIDATION_FAILED') {
      await ensureMinDuration(startedAt, minDelayMs)
    }
    throw err
  }
}

export async function revokeDevice(
  actor: IdentityAuthActor,
  rawInput: { deviceId: string; reasonCode: DeviceRevokeReason },
  deps?: IdentityServiceDeps,
): Promise<void> {
  requireActorPermission(actor, 'user.manage')
  const parsedRes = revokeDeviceSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid device revoke input')
  }
  const { deviceId, reasonCode } = parsedRes.data
  const nowIso = nowIsoFrom(deps)

  let credentialHashToInvalidate: Buffer | null = null

  await withTenant(actor.tenantId, async (tx) => {
    const dev = await findDeviceForRevoke(tx, actor.tenantId, deviceId)
    if (!dev) {
      throw new AppError('VALIDATION_FAILED', 'Device not found')
    }
    requireActorPermission(actor, 'user.manage', { outletId: dev.outletId })

    credentialHashToInvalidate = dev.credentialHash
    if (dev.revokedAt !== null) {
      return
    }

    await markDeviceRevoked(tx, {
      tenantId: actor.tenantId,
      deviceId,
      revokedBy: actor.appUserId,
      reasonCode,
      nowIso,
    })

    const activePinIds = await listActiveStaffPinDeviceIds(tx, actor.tenantId, deviceId)
    if (activePinIds.length > 0) {
      await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        await tombstoneStaffPinsByDevice(tx, w, actor.tenantId, deviceId, nowIso)
        return true
      })
    }

    await appendAudit(
      tx,
      {
        action: 'device.revoked',
        entityType: 'device',
        entityId: dev.id,
        outletId: dev.outletId,
        registerId: dev.registerId,
        deviceId: dev.id,
        reasonCode,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
        beforeData: { name: dev.name },
        afterData: { revoked: true, reasonCode },
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )
  })

  invalidateDeviceAuthCacheByDeviceId(deviceId)
  if (credentialHashToInvalidate) {
    invalidateDeviceAuthCacheByHash(credentialHashToInvalidate)
  }
}

/**
 * Revokes a device inside an already-open tenant transaction (used by atomic register recovery).
 * Caller MUST invoke `invalidateDeviceCachesForIds` after transaction commit.
 */
export async function revokeDeviceInTx(
  tx: TenantTx,
  actor: IdentityAuthActor,
  params: { deviceId: string; reasonCode: DeviceRevokeReason; nowIso: string },
): Promise<{ credentialHash: Buffer | null }> {
  const dev = await findDeviceForRevoke(tx, actor.tenantId, params.deviceId)
  if (!dev) {
    throw new AppError('VALIDATION_FAILED', 'Device not found')
  }
  requireActorPermission(actor, 'user.manage', { outletId: dev.outletId })

  if (dev.revokedAt !== null) {
    return { credentialHash: dev.credentialHash }
  }

  await markDeviceRevoked(tx, {
    tenantId: actor.tenantId,
    deviceId: params.deviceId,
    revokedBy: actor.appUserId,
    reasonCode: params.reasonCode,
    nowIso: params.nowIso,
  })

  const activePinIds = await listActiveStaffPinDeviceIds(tx, actor.tenantId, params.deviceId)
  if (activePinIds.length > 0) {
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tombstoneStaffPinsByDevice(tx, w, actor.tenantId, params.deviceId, params.nowIso)
      return true
    })
  }

  await appendAudit(
    tx,
    {
      action: 'device.revoked',
      entityType: 'device',
      entityId: dev.id,
      outletId: dev.outletId,
      registerId: dev.registerId,
      deviceId: dev.id,
      reasonCode: params.reasonCode,
      actorUserId: actor.appUserId,
      occurredAt: params.nowIso,
      beforeData: { name: dev.name },
      afterData: { revoked: true, reasonCode: params.reasonCode },
    },
    { newId: () => identityIdGen.newId(), nowIso: () => params.nowIso },
  )

  return { credentialHash: dev.credentialHash }
}

export function invalidateRevokedDeviceAuthCaches(deviceId: string, credentialHash: Buffer | null): void {
  invalidateDeviceAuthCacheByDeviceId(deviceId)
  if (credentialHash) {
    invalidateDeviceAuthCacheByHash(credentialHash)
  }
}

export async function listDevices(actor: IdentityAuthActor): Promise<DeviceView[]> {
  requireActorPermission(actor, 'user.manage')
  const allowedOutletIds = actor.outletIds === null ? null : new Set(actor.outletIds ?? [])

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const rows = await listDevicesWithSyncStatusRows(tx, actor.tenantId)
    return rows
      .filter((r) => allowedOutletIds === null || allowedOutletIds.has(r.outletId))
      .map((r) => ({
        id: r.id,
        outletId: r.outletId,
        outletCode: r.outletCode,
        registerId: r.registerId,
        registerCode: r.registerCode,
        registerName: r.registerName,
        name: r.name,
        enrolledAt: r.enrolledAt,
        revokedAt: r.revokedAt,
        revokeReasonCode: (r.revokeReasonCode as DeviceRevokeReason | null) ?? null,
        lastAttemptAt: r.lastAttemptAt,
        lastSuccessSyncAt: r.lastSuccessSyncAt,
        pendingCount: Number(r.pendingCount),
        oldestPendingAt: r.oldestPendingAt,
        clockOffsetMs: r.clockOffsetMs,
        appVersion: r.appVersion,
        schemaVersion: r.schemaVersion,
        storagePersist: (r.storagePersist as DeviceStoragePersist) ?? 'UNKNOWN',
        neverSynced: r.lastSuccessSyncAt === null,
      }))
  })
}

/**
 * Extends credential expiry to `now + 180d` ONLY when remaining lifetime is below 150 days,
 * avoiding hot-row writes on routine sync calls.
 */
export async function extendCredentialIfNeeded(
  tx: TenantTx,
  tenantId: string,
  deviceId: string,
  nowIso: string,
): Promise<boolean> {
  const nowMs = Date.parse(nowIso)
  const renewThresholdIso = new Date(nowMs + CREDENTIAL_RENEW_THRESHOLD_MS).toISOString()
  const nextExpiresAtIso = new Date(nowMs + CREDENTIAL_TTL_MS).toISOString()
  return extendDeviceCredentialIfBelowThreshold(tx, {
    tenantId,
    deviceId,
    renewThresholdIso,
    nextExpiresAtIso,
    nowIso,
  })
}
