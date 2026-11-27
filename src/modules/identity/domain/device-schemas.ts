import { z } from 'zod'

export const DEVICE_REVOKE_REASONS = ['LOST', 'REPLACED', 'STOLEN', 'OTHER'] as const
export type DeviceRevokeReason = (typeof DEVICE_REVOKE_REASONS)[number]

export const DEVICE_STORAGE_PERSIST = ['GRANTED', 'DENIED', 'UNKNOWN'] as const
export type DeviceStoragePersist = (typeof DEVICE_STORAGE_PERSIST)[number]

export const createPairingCodeSchema = z.object({
  registerId: z.string().uuid(),
})

export const revokeDeviceSchema = z.object({
  deviceId: z.string().uuid(),
  reasonCode: z.enum(DEVICE_REVOKE_REASONS),
})

export interface CreatePairingCodeResult {
  code: string
  expiresAt: string
  enrollUrl: string
  baseUrl: string
}

export interface DeviceView {
  id: string
  outletId: string
  outletCode: string
  registerId: string
  registerCode: string
  registerName: string
  name: string
  enrolledAt: string
  revokedAt: string | null
  revokeReasonCode: DeviceRevokeReason | null
  lastAttemptAt: string | null
  lastSuccessSyncAt: string | null
  pendingCount: number
  oldestPendingAt: string | null
  clockOffsetMs: number | null
  appVersion: string | null
  schemaVersion: number | null
  storagePersist: DeviceStoragePersist
  neverSynced: boolean
}
