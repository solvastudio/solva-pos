import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatInvoiceNo, parseInvoiceNo, validateInvoicePrefix, type DocKind } from './numbering'
import { businessDate, invoicePeriod } from './time'

describe('kernel/numbering (V-29 + properti)', () => {
  it('memenuhi vektor uji V-29 (format invoice & nota kredit dengan jam potong)', () => {
    const bd1 = businessDate('2026-11-17T07:05:00.000Z', 'Asia/Jakarta', '04:00')
    expect(
      formatInvoiceNo({
        prefix: 'OUT01-POS02',
        kind: 'INVOICE',
        period: invoicePeriod(bd1),
        seq: 123,
      }),
    ).toBe('OUT01-POS02-1126-000123')

    const bd2 = businessDate('2026-11-30T18:00:00.000Z', 'Asia/Jakarta', '04:00') // 2026-12-01 01:00 WIB
    expect(bd2).toBe('2026-11-30')
    expect(invoicePeriod(bd2)).toBe('1126')

    const bd3 = businessDate('2026-11-30T21:05:00.000Z', 'Asia/Jakarta', '04:00') // 2026-12-01 04:05 WIB
    expect(
      formatInvoiceNo({
        prefix: 'OUT01-POS02',
        kind: 'INVOICE',
        period: invoicePeriod(bd3),
        seq: 1,
      }),
    ).toBe('OUT01-POS02-1226-000001')

    expect(
      formatInvoiceNo({
        prefix: 'OUT01-POS02',
        kind: 'CREDIT_NOTE',
        period: '1126',
        seq: 1,
      }),
    ).toBe('OUT01-POS02-NK-1126-000001')

    expect(
      formatInvoiceNo({
        prefix: 'KSR2',
        kind: 'INVOICE',
        period: '1126',
        seq: 123,
      }),
    ).toBe('KSR2-1126-000123')
  })

  it('memvalidasi prefiks dan sufiks konflik -D{n}', () => {
    expect(validateInvoicePrefix('OUT01-POS02')).toEqual({ ok: true })
    expect(validateInvoicePrefix('NK')).toEqual({ ok: false, reason: 'ENDS_WITH_NK' })
    expect(validateInvoicePrefix('OUT01-NK')).toEqual({ ok: false, reason: 'ENDS_WITH_NK' })
    expect(validateInvoicePrefix('A')).toEqual({ ok: false, reason: 'FORMAT' })
    expect(validateInvoicePrefix('-OUT01')).toEqual({ ok: false, reason: 'FORMAT' })
    expect(validateInvoicePrefix('OUT--01')).toEqual({ ok: false, reason: 'FORMAT' })
    expect(validateInvoicePrefix('out01')).toEqual({ ok: false, reason: 'FORMAT' })

    const dup = formatInvoiceNo({
      prefix: 'KSR1',
      kind: 'CREDIT_NOTE',
      period: '1126',
      seq: 1_234_567,
      conflictIdx: 2,
    })
    expect(dup).toBe('KSR1-NK-1126-1234567-D2')
    expect(parseInvoiceNo(dup)).toEqual({
      prefix: 'KSR1',
      kind: 'CREDIT_NOTE',
      period: '1126',
      seq: 1_234_567,
      conflictIdx: 2,
    })

    expect(parseInvoiceNo('INVALID')).toBeNull()
    expect(parseInvoiceNo('OUT01-1326-000001')).toBeNull()
    expect(parseInvoiceNo('OUT01-NK-1126-000001-D0')).toBeNull()
  })

  it('properti: parseInvoiceNo(formatInvoiceNo(x)) === x', () => {
    const segmentArb = fc
      .string({ minLength: 1, maxLength: 6 })
      .filter((s) => /^[A-Z0-9]+$/.test(s))
    const prefixArb = fc
      .array(segmentArb, { minLength: 1, maxLength: 3 })
      .map((parts) => parts.join('-'))
      .filter((p) => validateInvoicePrefix(p).ok)

    const periodArb = fc
      .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 0, max: 99 }))
      .map(([m, y]) => `${String(m).padStart(2, '0')}${String(y).padStart(2, '0')}`)

    fc.assert(
      fc.property(
        prefixArb,
        fc.constantFrom<DocKind>('INVOICE', 'CREDIT_NOTE'),
        periodArb,
        fc.integer({ min: 1, max: 2_000_000 }),
        fc.integer({ min: 0, max: 5 }),
        (prefix, kind, period, seq, conflictIdx) => {
          const formatted = formatInvoiceNo({ prefix, kind, period, seq, conflictIdx })
          expect(parseInvoiceNo(formatted)).toEqual({
            prefix,
            kind,
            period,
            seq,
            conflictIdx,
          })
        },
      ),
      { numRuns: 200 },
    )
  })
})
