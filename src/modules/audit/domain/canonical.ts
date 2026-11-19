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

function normalizeJsonValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item))
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      const v = obj[k]
      if (v === undefined) continue
      out[k] = normalizeJsonValue(v)
    }
    return out
  }
  return null
}

/** Serialize an arbitrary JSON value with sorted keys, no spaces, and `undefined -> null`. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value))
}

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
  ].map((v) => normalizeJsonValue(v))
  return JSON.stringify(ordered)
}
