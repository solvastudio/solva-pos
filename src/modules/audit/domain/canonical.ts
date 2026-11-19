import { canonicalJson } from '~/lib/kernel'

export interface CanonicalAuditFields {
  id: string
  tenantId: string
  chainSeq: number
  outletId: string | null
  registerId: string | null
  deviceId: string | null
  actorUserId: string | null
  approverUserId: string | null
  action: string
  entityType: string
  entityId: string | null
  beforeData: unknown | null
  afterData: unknown | null
  reasonCode: string | null
  reasonText: string | null
  occurredAtDevice: string | null
  clockOffsetMs: number | null
  occurredAt: string
  recordedAt: string
  businessDate: string | null
  commandId: string | null
  requestRef: string | null
  schemaVersion: number | null
  appVersion: string | null
}

export { canonicalJson }

/** Serialize audit entry fields in a fixed column order for chained SHA-256 hashing. */
export function canonicalizeAudit(f: CanonicalAuditFields): string {
  const ordered = [
    f.id,
    f.tenantId,
    f.chainSeq,
    f.outletId,
    f.registerId,
    f.deviceId,
    f.actorUserId,
    f.approverUserId,
    f.action,
    f.entityType,
    f.entityId,
    f.beforeData,
    f.afterData,
    f.reasonCode,
    f.reasonText,
    f.occurredAtDevice,
    f.clockOffsetMs,
    f.occurredAt,
    f.recordedAt,
    f.businessDate,
    f.commandId,
    f.requestRef,
    f.schemaVersion,
    f.appVersion,
  ]
  return canonicalJson(ordered)
}
