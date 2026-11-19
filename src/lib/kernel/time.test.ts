import { describe, expect, it } from 'vitest'
import { businessDate, invoicePeriod, isValidIso, OUTLET_TIMEZONES, returnWindowEnd } from './time'

describe('kernel/time (V-22, V-23)', () => {
  it('satisfies V-22: businessDate in Asia/Jakarta with 04:00 cutoff inclusive of start boundary', () => {
    expect(businessDate('2026-11-17T19:30:00.000Z', 'Asia/Jakarta', '04:00')).toBe('2026-11-17')
    expect(businessDate('2026-11-17T21:00:00.000Z', 'Asia/Jakarta', '04:00')).toBe('2026-11-18')
    expect(businessDate('2026-11-30T18:00:00.000Z', 'Asia/Jakarta', '04:00')).toBe('2026-11-30')
  })

  it('supports all outlet timezones (WIB/WITA/WIT)', () => {
    expect(OUTLET_TIMEZONES).toEqual(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'])
    // 2026-11-17T16:30Z -> WIB 23:30 (17 Nov), WITA 00:30 (18 Nov), WIT 01:30 (18 Nov)
    expect(businessDate('2026-11-17T16:30:00.000Z', 'Asia/Jakarta', '00:00')).toBe('2026-11-17')
    expect(businessDate('2026-11-17T16:30:00.000Z', 'Asia/Makassar', '00:00')).toBe('2026-11-18')
    expect(businessDate('2026-11-17T16:30:00.000Z', 'Asia/Jayapura', '00:00')).toBe('2026-11-18')
  })

  it('computes invoicePeriod MMYY and returnWindowEnd per V-23 (BR-RTR-003, BR-INV-003)', () => {
    expect(invoicePeriod('2026-11-30')).toBe('1126')
    expect(invoicePeriod('2026-12-01')).toBe('1226')

    expect(returnWindowEnd('2026-08-31', 3)).toBe('2026-11-30')
    expect(returnWindowEnd('2026-08-15', 3)).toBe('2026-11-15')
    expect(returnWindowEnd('2024-01-31', 1)).toBe('2024-02-29')
    expect(returnWindowEnd('2025-01-31', 1)).toBe('2025-02-28')
  })

  it('validates ISO-8601 UTC and rejects malformed inputs', () => {
    expect(isValidIso('2026-11-17T19:30:00.000Z')).toBe(true)
    expect(isValidIso('2026-11-17T19:30:00Z')).toBe(true)
    expect(isValidIso('2026-11-17T19:30:00+07:00')).toBe(false)
    expect(isValidIso('2026-02-30T00:00:00Z')).toBe(false)
    expect(() => businessDate('invalid', 'Asia/Jakarta', '04:00')).toThrowError(RangeError)
    expect(() => businessDate('2026-11-17T19:30:00Z', 'Asia/Jakarta', '24:00')).toThrowError(
      RangeError,
    )
  })
})
