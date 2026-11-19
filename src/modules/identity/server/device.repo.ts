import '@tanstack/react-start/server-only'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { NoTenantTx, TenantTx } from '~/server/db'
import { device, deviceSyncStatus, pairingCode } from './device-schema'
import { cashMaster, outlet, tenant } from './schema'

export interface RegisterEnrollInfoRow {
  id: string
  outletId: string
  outletCode: string
  outletName: string
  outletTimezone: string
  outletDayCutoffTime: string
  code: string
  name: string
  status: string
  registerType: string
  paperWidthMm: number
}

export interface TenantEnrollInfoRow {
  id: string
  slug: string
  name: string
  defaultLocale: string
}

export interface DeviceSyncListDbRow {
  id: string
  outletId: string
  outletCode: string
  registerId: string
  registerCode: string
  registerName: string
  name: string
  enrolledAt: string
  revokedAt: string | null
  revokeReasonCode: string | null
  lastAttemptAt: string | null
  lastSuccessSyncAt: string | null
  pendingCount: number
  oldestPendingAt: string | null
  clockOffsetMs: number | null
  appVersion: string | null
  schemaVersion: number | null
  storagePersist: string
}

export interface ResolvedDeviceDbRow {
  deviceId: string
  tenantId: string
  registerId: string
  outletId: string
  registerType: string
  registerStatus: string
  revokedAt: string | null
  credentialExpiresAt: string
  tenantStatus: string
}

export async function findRegisterWithOutletForDevice(
  tx: TenantTx,
  tenantId: string,
  registerId: string,
): Promise<RegisterEnrollInfoRow | null> {
  const rows = await tx
    .select({
      id: cashMaster.id,
      outletId: cashMaster.outletId,
      outletCode: outlet.code,
      outletName: outlet.name,
      outletTimezone: outlet.timezone,
      outletDayCutoffTime: outlet.dayCutoffTime,
      code: cashMaster.code,
      name: cashMaster.name,
      status: cashMaster.status,
      registerType: cashMaster.registerType,
      paperWidthMm: cashMaster.paperWidthMm,
    })
    .from(cashMaster)
    .innerJoin(
      outlet,
      and(eq(outlet.tenantId, cashMaster.tenantId), eq(outlet.id, cashMaster.outletId)),
    )
    .where(
      and(
        eq(cashMaster.tenantId, tenantId),
        eq(cashMaster.id, registerId),
        isNull(cashMaster.deletedAt),
        isNull(outlet.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function findTenantEnrollMeta(
  tx: TenantTx,
  tenantId: string,
): Promise<TenantEnrollInfoRow | null> {
  const rows = await tx
    .select({
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      defaultLocale: tenant.defaultLocale,
    })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1)
  return rows[0] ?? null
}

export async function deleteUnusedPairingCodesForRegister(
  tx: TenantTx,
  tenantId: string,
  registerId: string,
): Promise<void> {
  await tx
    .delete(pairingCode)
    .where(
      and(
        eq(pairingCode.tenantId, tenantId),
        eq(pairingCode.registerId, registerId),
        isNull(pairingCode.usedAt),
      ),
    )
}

export async function insertPairingCodeRow(
  tx: TenantTx,
  params: {
    id: string
    tenantId: string
    registerId: string
    codeHash: Buffer
    expiresAt: string
    createdBy: string
    createdAt: string
  },
): Promise<void> {
  await tx.insert(pairingCode).values({
    id: params.id,
    tenantId: params.tenantId,
    registerId: params.registerId,
    codeHash: params.codeHash,
    expiresAt: params.expiresAt,
    createdBy: params.createdBy,
    createdAt: params.createdAt,
  })
}

export async function atomicClaimPairingCode(
  tx: TenantTx,
  tenantId: string,
  codeHash: Buffer,
  nowIso: string,
): Promise<{ id: string; registerId: string; createdBy: string } | null> {
  const res = await tx.execute(
    sql`UPDATE pairing_code
        SET used_at = ${nowIso}::timestamptz
        WHERE tenant_id = ${tenantId}::uuid
          AND code_hash = ${codeHash}
          AND used_at IS NULL
          AND expires_at > ${nowIso}::timestamptz
        RETURNING id, register_id, created_by`,
  )
  const row = res.rows[0] as
    | { id: unknown; register_id: unknown; created_by: unknown }
    | undefined
  if (!row) return null
  return {
    id: String(row.id),
    registerId: String(row.register_id),
    createdBy: String(row.created_by),
  }
}

export async function findActiveDeviceForRegister(
  tx: TenantTx,
  tenantId: string,
  registerId: string,
): Promise<{ id: string } | null> {
  const rows = await tx
    .select({ id: device.id })
    .from(device)
    .where(
      and(
        eq(device.tenantId, tenantId),
        eq(device.registerId, registerId),
        isNull(device.revokedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function insertDeviceAndSyncStatus(
  tx: TenantTx,
  params: {
    deviceId: string
    tenantId: string
    registerId: string
    name: string
    credentialHash: Buffer
    credentialIssuedAt: string
    credentialExpiresAt: string
    pairingCodeId: string
    userAgent: string | null
    enrolledAt: string
    enrolledBy: string
  },
): Promise<void> {
  await tx.insert(device).values({
    id: params.deviceId,
    tenantId: params.tenantId,
    registerId: params.registerId,
    name: params.name,
    credentialHash: params.credentialHash,
    credentialIssuedAt: params.credentialIssuedAt,
    credentialExpiresAt: params.credentialExpiresAt,
    pairingCodeId: params.pairingCodeId,
    userAgent: params.userAgent,
    enrolledAt: params.enrolledAt,
    enrolledBy: params.enrolledBy,
    createdAt: params.enrolledAt,
    updatedAt: params.enrolledAt,
  })

  await tx.insert(deviceSyncStatus).values({
    deviceId: params.deviceId,
    tenantId: params.tenantId,
    registerId: params.registerId,
    pendingCount: 0,
    attentionCount: 0,
    storagePersist: 'UNKNOWN',
    updatedAt: params.enrolledAt,
  })

  await tx
    .update(pairingCode)
    .set({ usedByDeviceId: params.deviceId })
    .where(and(eq(pairingCode.tenantId, params.tenantId), eq(pairingCode.id, params.pairingCodeId)))
}

export async function findDeviceForRevoke(
  tx: TenantTx,
  tenantId: string,
  deviceId: string,
): Promise<{
  id: string
  outletId: string
  registerId: string
  name: string
  revokedAt: string | null
  credentialHash: Buffer
} | null> {
  const rows = await tx
    .select({
      id: device.id,
      outletId: cashMaster.outletId,
      registerId: device.registerId,
      name: device.name,
      revokedAt: device.revokedAt,
      credentialHash: device.credentialHash,
    })
    .from(device)
    .innerJoin(
      cashMaster,
      and(eq(cashMaster.tenantId, device.tenantId), eq(cashMaster.id, device.registerId)),
    )
    .where(and(eq(device.tenantId, tenantId), eq(device.id, deviceId)))
    .limit(1)
  return rows[0] ?? null
}

export async function markDeviceRevoked(
  tx: TenantTx,
  params: {
    tenantId: string
    deviceId: string
    revokedBy: string
    reasonCode: string
    nowIso: string
  },
): Promise<void> {
  await tx
    .update(device)
    .set({
      revokedAt: params.nowIso,
      revokedBy: params.revokedBy,
      revokeReasonCode: params.reasonCode,
      updatedAt: params.nowIso,
    })
    .where(
      and(
        eq(device.tenantId, params.tenantId),
        eq(device.id, params.deviceId),
        isNull(device.revokedAt),
      ),
    )
}

export async function listDevicesWithSyncStatusRows(
  tx: TenantTx,
  tenantId: string,
): Promise<DeviceSyncListDbRow[]> {
  return tx
    .select({
      id: device.id,
      outletId: outlet.id,
      outletCode: outlet.code,
      registerId: device.registerId,
      registerCode: cashMaster.code,
      registerName: cashMaster.name,
      name: device.name,
      enrolledAt: device.enrolledAt,
      revokedAt: device.revokedAt,
      revokeReasonCode: device.revokeReasonCode,
      lastAttemptAt: deviceSyncStatus.lastAttemptAt,
      lastSuccessSyncAt: deviceSyncStatus.lastSuccessSyncAt,
      pendingCount: sql<number>`COALESCE(${deviceSyncStatus.pendingCount}, 0)`,
      oldestPendingAt: deviceSyncStatus.oldestPendingAt,
      clockOffsetMs: deviceSyncStatus.clockOffsetMs,
      appVersion: deviceSyncStatus.appVersion,
      schemaVersion: deviceSyncStatus.schemaVersion,
      storagePersist: sql<string>`COALESCE(${deviceSyncStatus.storagePersist}, 'UNKNOWN')`,
    })
    .from(device)
    .innerJoin(
      cashMaster,
      and(eq(cashMaster.tenantId, device.tenantId), eq(cashMaster.id, device.registerId)),
    )
    .innerJoin(
      outlet,
      and(eq(outlet.tenantId, cashMaster.tenantId), eq(outlet.id, cashMaster.outletId)),
    )
    .leftJoin(
      deviceSyncStatus,
      and(eq(deviceSyncStatus.tenantId, device.tenantId), eq(deviceSyncStatus.deviceId, device.id)),
    )
    .where(eq(device.tenantId, tenantId))
    .orderBy(sql`${device.revokedAt} IS NOT NULL`, desc(device.enrolledAt))
}

export interface UpdateDeviceSyncStatusParams {
  tenantId: string
  deviceId: string
  lastAttemptAt: string
  lastPushAt: string | null
  lastPullAt: string | null
  lastSuccessSyncAt: string | null
  pullCursorVersion: number | null
  appVersion: string | null
  schemaVersion: number | null
  syncProtocolVersion: number | null
  clockOffsetMs: number | null
  clockOffsetAt: string | null
  applyReport: boolean
  pendingCount: number | null
  oldestPendingAt: string | null
  attentionCount: number | null
  storagePersist: string | null
  storageUsedPct: number | null
  lastErrorCode: string | null
  lastErrorRef: string | null
}

export async function updateDeviceSyncStatusRow(
  tx: TenantTx,
  params: UpdateDeviceSyncStatusParams,
): Promise<void> {
  await tx.execute(
    sql`UPDATE device_sync_status
        SET last_attempt_at = ${params.lastAttemptAt}::timestamptz,
            last_push_at = COALESCE(${params.lastPushAt}::timestamptz, last_push_at),
            last_pull_at = COALESCE(${params.lastPullAt}::timestamptz, last_pull_at),
            last_success_sync_at = COALESCE(${params.lastSuccessSyncAt}::timestamptz, last_success_sync_at),
            pull_cursor_version = COALESCE(${params.pullCursorVersion}::bigint, pull_cursor_version),
            app_version = COALESCE(${params.appVersion}::text, app_version),
            schema_version = COALESCE(${params.schemaVersion}::integer, schema_version),
            sync_protocol_version = COALESCE(${params.syncProtocolVersion}::integer, sync_protocol_version),
            clock_offset_ms = COALESCE(${params.clockOffsetMs}::integer, clock_offset_ms),
            clock_offset_at = COALESCE(${params.clockOffsetAt}::timestamptz, clock_offset_at),
            pending_count = COALESCE(${params.pendingCount}::integer, pending_count),
            oldest_pending_at = CASE WHEN ${params.applyReport}::boolean THEN ${params.oldestPendingAt}::timestamptz ELSE oldest_pending_at END,
            attention_count = COALESCE(${params.attentionCount}::integer, attention_count),
            storage_persist = COALESCE(${params.storagePersist}::text, storage_persist),
            storage_used_pct = CASE WHEN ${params.applyReport}::boolean THEN ${params.storageUsedPct}::smallint ELSE storage_used_pct END,
            last_error_code = CASE WHEN ${params.applyReport}::boolean THEN ${params.lastErrorCode}::text ELSE last_error_code END,
            last_error_ref = CASE WHEN ${params.applyReport}::boolean THEN ${params.lastErrorRef}::text ELSE last_error_ref END,
            updated_at = ${params.lastAttemptAt}::timestamptz
        WHERE tenant_id = ${params.tenantId}::uuid
          AND device_id = ${params.deviceId}::uuid`,
  )
}

export async function extendDeviceCredentialIfBelowThreshold(
  tx: TenantTx,
  params: {
    tenantId: string
    deviceId: string
    renewThresholdIso: string
    nextExpiresAtIso: string
    nowIso: string
  },
): Promise<boolean> {
  const res = await tx.execute(
    sql`UPDATE device
        SET credential_expires_at = ${params.nextExpiresAtIso}::timestamptz,
            updated_at = ${params.nowIso}::timestamptz
        WHERE tenant_id = ${params.tenantId}::uuid
          AND id = ${params.deviceId}::uuid
          AND revoked_at IS NULL
          AND credential_expires_at < ${params.renewThresholdIso}::timestamptz
        RETURNING id`,
  )
  return res.rows.length > 0
}

export async function callResolveDeviceByCredential(
  tx: NoTenantTx,
  credentialHash: Buffer,
): Promise<ResolvedDeviceDbRow | null> {
  const res = await tx.execute(
    sql`SELECT device_id, tenant_id, register_id, outlet_id, register_type, register_status,
               revoked_at, credential_expires_at, tenant_status
          FROM resolve_device_by_credential(${credentialHash})`,
  )
  const row = res.rows[0] as
    | {
        device_id: unknown
        tenant_id: unknown
        register_id: unknown
        outlet_id: unknown
        register_type: unknown
        register_status: unknown
        revoked_at: unknown
        credential_expires_at: unknown
        tenant_status: unknown
      }
    | undefined
  if (!row) return null
  return {
    deviceId: String(row.device_id),
    tenantId: String(row.tenant_id),
    registerId: String(row.register_id),
    outletId: String(row.outlet_id),
    registerType: String(row.register_type),
    registerStatus: String(row.register_status),
    revokedAt:
      row.revoked_at instanceof Date
        ? row.revoked_at.toISOString()
        : row.revoked_at
          ? String(row.revoked_at)
          : null,
    credentialExpiresAt:
      row.credential_expires_at instanceof Date
        ? row.credential_expires_at.toISOString()
        : String(row.credential_expires_at),
    tenantStatus: String(row.tenant_status),
  }
}
