// Kode tidak boleh dihapus atau diubah artinya; hanya ditambah (AD-35).
// Ubah snapshot hanya bersama keputusan user.

export type ErrorClass =
  | 'authorization'
  | 'structural'
  | 'transient'
  | 'system'
  | 'schema'
  | 'business'

export interface ErrorCodeMeta {
  readonly class: ErrorClass
  readonly http: number | null
  readonly source: 'server' | 'client' | 'both'
  readonly deprecated?: true
  readonly replacedBy?: ErrorCode
}

export const ERROR_CODES = {
  UNAUTHORIZED: { class: 'authorization', http: 401, source: 'server' },
  FORBIDDEN: { class: 'authorization', http: 403, source: 'server' },
  VALIDATION_FAILED: { class: 'structural', http: 400, source: 'server' },
  DB_UNAVAILABLE: { class: 'transient', http: 503, source: 'server' },
  TIMEOUT: { class: 'transient', http: 504, source: 'both' },
  INTERNAL_ERROR: { class: 'system', http: 500, source: 'server' },
  PRINT_FAILED: { class: 'transient', http: null, source: 'client' },
  PIN_LOCKED: { class: 'authorization', http: null, source: 'client' },
  DEVICE_REVOKED: { class: 'authorization', http: 403, source: 'server' },
  CREDENTIAL_EXPIRED: { class: 'authorization', http: 401, source: 'server' },
  LEASE_EXPIRED: { class: 'authorization', http: null, source: 'client' },
  UPDATE_REQUIRED: { class: 'schema', http: 426, source: 'server' },
  SYNC_HELD: { class: 'schema', http: null, source: 'both' },
  TENANT_SUSPENDED: { class: 'authorization', http: 403, source: 'server' },
  STORAGE_LOW: { class: 'transient', http: null, source: 'client' },
  STORAGE_FULL: { class: 'system', http: null, source: 'client' },
  LOCAL_DB_FAILED: { class: 'system', http: null, source: 'client' },
  APP_ERROR: { class: 'system', http: null, source: 'client' },
  HANDOVER_NOT_PENDING: { class: 'business', http: 409, source: 'server' },
  EVENTS_PENDING: { class: 'business', http: 409, source: 'server' },
  RATE_LIMITED: { class: 'authorization', http: 429, source: 'server' },
  FEATURE_DISABLED: { class: 'authorization', http: 403, source: 'server' },
} as const satisfies Record<string, ErrorCodeMeta>

export type ErrorCode = keyof typeof ERROR_CODES

export function isErrorCode(s: string): s is ErrorCode {
  return Object.hasOwn(ERROR_CODES, s)
}

export function classOf(code: string): ErrorClass {
  return isErrorCode(code) ? ERROR_CODES[code].class : 'system'
}

export function formatPublicCode(code: string, ref: string): string {
  return `${code}#${ref}`
}

const PUBLIC_CODE_PATTERN = /^([A-Z][A-Z0-9_]*)#([A-Za-z0-9._-]{1,64})$/

export function parsePublicCode(s: string): { code: string; ref: string } | null {
  if (typeof s !== 'string') return null
  const match = PUBLIC_CODE_PATTERN.exec(s)
  if (!match) return null
  return { code: match[1]!, ref: match[2]! }
}

/** Kode alasan DATA pada antrean "perlu perhatian" (SCHEMA §4.6.3, bukan kode tampilan). */
export const DATA_REASON_CODES = [
  'VALIDATION_FAILED',
  'UNKNOWN_REFERENCE',
  'DEVICE_REVOKED',
  'CREDENTIAL_INVALID',
  'SERIES_CONFLICT',
  'RETURN_EXCEEDS_QTY',
  'PAYMENT_MISMATCH',
  'SCHEMA_NOT_MIGRATABLE',
] as const

export type DataReasonCode = (typeof DATA_REASON_CODES)[number]

/** Kode tambahan khusus log diagnostik perangkat (SCHEMA Lampiran A.5 butir 3). */
export const DEVICE_LOG_EXTRA_CODES = [
  'SYNC_FAILED',
  'CLOCK_ANOMALY',
  'PERSIST_DENIED',
  'UPDATE_ACCEPTED',
  'UPDATE_REJECTED',
] as const

export type DeviceLogExtraCode = (typeof DEVICE_LOG_EXTRA_CODES)[number]
