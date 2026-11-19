import '@tanstack/react-start/server-only'
import type { DeviceReport } from '~/lib/contracts'
import type { TenantTx } from '~/server/db'
import { updateDeviceSyncStatusRow } from './device.repo'

export interface TouchDeviceStatusInput {
  lastAttemptAt: string
  lastPushAt?: string | null
  lastPullAt?: string | null
  lastSuccessSyncAt?: string | null
  pullCursorVersion?: number | null
  appVersion?: string | null
  schemaVersion?: number | null
  syncProtocolVersion?: number | null
  clockOffsetMs?: number | null
  clockOffsetAt?: string | null
  report?: DeviceReport
}

/**
 * Updates `device_sync_status` for an active device, applying explicit `DeviceReport` telemetry
 * when present while preserving omitted header/sync columns.
 */
export async function touchDeviceStatus(
  tx: TenantTx,
  tenantId: string,
  deviceId: string,
  patch: TouchDeviceStatusInput,
): Promise<void> {
  const lastPushAt = patch.lastPushAt ?? null
  const lastPullAt = patch.lastPullAt ?? null
  const lastSuccessSyncAt =
    patch.lastSuccessSyncAt !== undefined ? (patch.lastSuccessSyncAt ?? null) : lastPushAt
  const rep = patch.report
  const clockOffsetMs = rep?.clock_offset_ms ?? patch.clockOffsetMs ?? null
  const clockOffsetAt =
    clockOffsetMs !== null ? (patch.clockOffsetAt ?? patch.lastAttemptAt) : null

  await updateDeviceSyncStatusRow(tx, {
    tenantId,
    deviceId,
    lastAttemptAt: patch.lastAttemptAt,
    lastPushAt,
    lastPullAt,
    lastSuccessSyncAt,
    pullCursorVersion: patch.pullCursorVersion ?? null,
    appVersion: rep?.app_version ?? patch.appVersion ?? null,
    schemaVersion: rep?.schema_version ?? patch.schemaVersion ?? null,
    syncProtocolVersion: rep?.sync_protocol_version ?? patch.syncProtocolVersion ?? null,
    clockOffsetMs,
    clockOffsetAt,
    applyReport: Boolean(rep),
    pendingCount: rep ? rep.pending_count : null,
    oldestPendingAt: rep ? rep.oldest_pending_at : null,
    attentionCount: rep ? rep.attention_count : null,
    storagePersist: rep ? rep.storage_persist : null,
    storageUsedPct: rep ? rep.storage_used_pct : null,
    lastErrorCode: rep ? rep.last_error_code : null,
    lastErrorRef: rep ? rep.last_error_ref : null,
  })
}
