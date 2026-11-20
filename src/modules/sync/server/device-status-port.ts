import '@tanstack/react-start/server-only'
import type { DeviceReport } from '~/lib/contracts'
import type { TenantTx } from '~/server/db'

export interface TouchDeviceStatusPatch {
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

export interface DeviceStatusPort {
  touchDeviceStatus(
    tx: TenantTx,
    tenantId: string,
    deviceId: string,
    patch: TouchDeviceStatusPatch,
  ): Promise<void>
  extendCredentialIfNeeded(
    tx: TenantTx,
    tenantId: string,
    deviceId: string,
    nowIso: string,
  ): Promise<boolean>
}

let registeredPort: DeviceStatusPort | null = null

export function registerDeviceStatusPort(port: DeviceStatusPort): void {
  registeredPort = port
}

export function getDeviceStatusPort(): DeviceStatusPort | null {
  return registeredPort
}

export function __clearDeviceStatusPortForTests(): void {
  registeredPort = null
  registeredAuditWriter = null
}

export interface SyncAuditEntryInput {
  readonly action: 'attention.resolved'
  readonly entityType: string
  readonly entityId: string
  readonly outletId?: string | null
  readonly registerId?: string | null
  readonly deviceId?: string | null
  readonly commandId?: string | null
  readonly reasonCode?: string | null
  readonly reasonText?: string | null
  readonly actorUserId?: string | null
  readonly occurredAt: string
  readonly beforeData?: unknown
  readonly afterData?: unknown
}

export type SyncAuditWriter = (
  tx: TenantTx,
  input: SyncAuditEntryInput,
  deps: { newId: () => string; nowIso: () => string },
) => Promise<unknown>

let registeredAuditWriter: SyncAuditWriter | null = null

export function registerSyncAuditWriter(writer: SyncAuditWriter): void {
  registeredAuditWriter = writer
}

export function getSyncAuditWriter(): SyncAuditWriter | null {
  return registeredAuditWriter
}
