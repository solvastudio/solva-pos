import '@tanstack/react-start/server-only'
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
}

/**
 * Updates `device_sync_status` for an active device, preserving existing non-null columns
 * when optional fields in the patch are omitted or null.
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
    patch.lastSuccessSyncAt !== undefined
      ? (patch.lastSuccessSyncAt ?? null)
      : (lastPushAt ?? lastPullAt)

  await updateDeviceSyncStatusRow(tx, {
    tenantId,
    deviceId,
    lastAttemptAt: patch.lastAttemptAt,
    lastPushAt,
    lastPullAt,
    lastSuccessSyncAt,
    pullCursorVersion: patch.pullCursorVersion ?? null,
    appVersion: patch.appVersion ?? null,
    schemaVersion: patch.schemaVersion ?? null,
    syncProtocolVersion: patch.syncProtocolVersion ?? null,
    clockOffsetMs: patch.clockOffsetMs ?? null,
    clockOffsetAt: patch.clockOffsetAt ?? null,
  })
}
