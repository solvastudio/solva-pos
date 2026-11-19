import { describe, expect, it } from 'vitest'
import {
  classOf,
  DATA_REASON_CODES,
  ERROR_CODES,
  formatPublicCode,
  isErrorCode,
  parsePublicCode,
  type ErrorClass,
} from './error-codes'

const VALID_CLASSES: readonly ErrorClass[] = [
  'authorization',
  'structural',
  'transient',
  'system',
  'schema',
  'business',
]

describe('contracts/error-codes (golden snapshot & stability)', () => {
  it('contains exactly 22 stable codes matching the golden snapshot', () => {
    expect(Object.keys(ERROR_CODES).sort()).toMatchInlineSnapshot(`
      [
        "APP_ERROR",
        "CREDENTIAL_EXPIRED",
        "DB_UNAVAILABLE",
        "DEVICE_REVOKED",
        "EVENTS_PENDING",
        "FEATURE_DISABLED",
        "FORBIDDEN",
        "HANDOVER_NOT_PENDING",
        "INTERNAL_ERROR",
        "LEASE_EXPIRED",
        "LOCAL_DB_FAILED",
        "PIN_LOCKED",
        "PRINT_FAILED",
        "RATE_LIMITED",
        "STORAGE_FULL",
        "STORAGE_LOW",
        "SYNC_HELD",
        "TENANT_SUSPENDED",
        "TIMEOUT",
        "UNAUTHORIZED",
        "UPDATE_REQUIRED",
        "VALIDATION_FAILED",
      ]
    `)
    expect(Object.keys(ERROR_CODES)).toHaveLength(22)
  })

  it('ensures every code has a valid class and consistent deprecated rules', () => {
    for (const [code, meta] of Object.entries(ERROR_CODES)) {
      expect(isErrorCode(code)).toBe(true)
      expect(VALID_CLASSES).toContain(meta.class)
      if ('deprecated' in meta && meta.deprecated) {
        expect('replacedBy' in meta && meta.replacedBy).toBeTruthy()
      }
    }
    expect(classOf('UNKNOWN_CUSTOM_CODE')).toBe('system')
    expect(classOf('TIMEOUT')).toBe('transient')
  })

  it('formats and parses CODE#id and preserves DATA_REASON_CODES list', () => {
    expect(formatPublicCode('TIMEOUT', '20261119-140500-k7q2m')).toBe(
      'TIMEOUT#20261119-140500-k7q2m',
    )
    expect(parsePublicCode('TIMEOUT#20261119-140500-k7q2m')).toEqual({
      code: 'TIMEOUT',
      ref: '20261119-140500-k7q2m',
    })
    expect(parsePublicCode('bad-code#123')).toBeNull()
    expect(DATA_REASON_CODES).toEqual([
      'VALIDATION_FAILED',
      'UNKNOWN_REFERENCE',
      'DEVICE_REVOKED',
      'CREDENTIAL_INVALID',
      'SERIES_CONFLICT',
      'RETURN_EXCEEDS_QTY',
      'PAYMENT_MISMATCH',
      'SCHEMA_NOT_MIGRATABLE',
    ])
  })
})
