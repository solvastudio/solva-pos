import { describe, expect, it } from 'vitest'
import { maskCustomerPhone, ReportFilterSchema } from './reports'

describe('ReportFilterSchema & maskCustomerPhone', () => {
  it('accepts valid date range up to 366 days and rejects inverted or >366 day ranges', () => {
    const valid = ReportFilterSchema.parse({
      from: '2026-01-01',
      to: '2026-12-31',
      groupBy: 'DAY',
    })
    expect(valid.outletIds).toEqual([])
    expect(valid.groupBy).toBe('DAY')

    // Inverted range rejected
    expect(() =>
      ReportFilterSchema.parse({
        from: '2026-11-18',
        to: '2026-11-17',
      }),
    ).toThrow(/from must be <= to/)

    // > 366 days rejected
    expect(() =>
      ReportFilterSchema.parse({
        from: '2025-01-01',
        to: '2026-01-03',
      }),
    ).toThrow(/366/)

    // Invalid calendar date rejected
    expect(() =>
      ReportFilterSchema.parse({
        from: '2026-02-30',
        to: '2026-03-01',
      }),
    ).toThrow(/Invalid calendar date/)
  })

  it('masks customer phone per BR-CUS-002 unless customer.view_phone is granted', () => {
    expect(maskCustomerPhone('08123456789', false)).toBe('0812****789')
    expect(maskCustomerPhone('08123456789', true)).toBe('08123456789')
    expect(maskCustomerPhone(null, false)).toBeNull()
    expect(maskCustomerPhone('   ', false)).toBeNull()
  })
})
