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
}
