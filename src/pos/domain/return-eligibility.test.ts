import { describe, expect, it } from 'vitest'
import { checkReturnEligibility, computeRemainingReturnQty } from './return-eligibility'

describe('pos/domain/return-eligibility (V-23)', () => {
  it('blocks VOID invoices and enforces the 3-month calendar window (V-23)', () => {
    expect(
      checkReturnEligibility({
        invoiceStatus: 'VOID',
        invoiceBusinessDate: '2026-11-20',
        todayBusinessDate: '2026-11-20',
      }),
    ).toEqual({ ok: false, reason: 'INVOICE_VOIDED' })

    expect(
      checkReturnEligibility({
        invoiceStatus: 'PAID',
        invoiceBusinessDate: '2025-11-30',
        todayBusinessDate: '2026-02-28',
      }),
    ).toEqual({ ok: true })

    expect(
      checkReturnEligibility({
        invoiceStatus: 'PAID',
        invoiceBusinessDate: '2025-11-30',
        todayBusinessDate: '2026-03-01',
      }),
    ).toEqual({ ok: false, reason: 'OUTSIDE_RETURN_WINDOW' })
  })

  it('computes remaining returnable quantity accurately in decimal', () => {
    expect(computeRemainingReturnQty('10', '3.333')).toBe('6.667')
    expect(computeRemainingReturnQty('5', '5')).toBe('0')
  })
})
