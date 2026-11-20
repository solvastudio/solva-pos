import { describe, expect, it } from 'vitest'
import { parseQty, toMoney, ZERO } from '~/lib/kernel'
import { calcAndSettle } from './full-sale'
import { calcCreditNote } from './return'
import { SALES_CALC_VECTORS } from './sales-calc.vectors'
import { verifyCreditNote, verifySale } from './verify'

describe('sales-calc/verify (BR-MNY-007, EC-029)', () => {
  it('passes verifySale on identical stored figures and flags Rs 1 discrepancy without mutating stored data', () => {
    const v04 = SALES_CALC_VECTORS.find((v) => v.id === 'V-04')!
    const payments = [{ methodCode: 'CASH', kind: 'CASH' as const, amount: toMoney(150000) }]
    const { calc, settlement } = calcAndSettle(v04.input, payments, 100)

    const stored = {
      lines: calc.lines.map((l) => ({ ...l })),
      grossTotal: calc.grossTotal,
      lineDiscountTotal: calc.lineDiscountTotal,
      billDiscountTotal: calc.billDiscountTotal,
      netSubtotal: calc.netSubtotal,
      serviceCharge: calc.serviceCharge,
      taxBase: calc.taxBase,
      taxAmount: calc.taxAmount,
      dpp: calc.dpp,
      grandTotal: calc.grandTotal,
      rounding: settlement.rounding,
      totalDue: settlement.totalDue,
    }

    expect(
      verifySale({ input: v04.input, payments, cashRoundingUnit: 100, stored }),
    ).toEqual({ ok: true, diffs: [] })

    // Simulate client off-by-1 rounding discrepancy (EC-029)
    const tamperedTax = {
      ...stored,
      taxAmount: toMoney(stored.taxAmount + 1),
    }
    const taxDiffRes = verifySale({
      input: v04.input,
      payments,
      cashRoundingUnit: 100,
      stored: tamperedTax,
    })
    expect(taxDiffRes.ok).toBe(false)
    expect(taxDiffRes.diffs).toEqual([
      { path: 'taxAmount', expected: 11146, actual: 11147 },
    ])
    // Stored facts were never mutated
    expect(tamperedTax.taxAmount).toBe(11147)

    // Detect per-line allocation discrepancy
    const tamperedLine = {
      ...stored,
      lines: stored.lines.map((l, idx) =>
        idx === 1 ? { ...l, taxAlloc: toMoney(l.taxAlloc - 1) } : l,
      ),
    }
    const lineDiffRes = verifySale({
      input: v04.input,
      payments,
      cashRoundingUnit: 100,
      stored: tamperedLine,
    })
    expect(lineDiffRes.ok).toBe(false)
    expect(lineDiffRes.diffs.some((d) => d.path === 'lines[1].taxAlloc')).toBe(true)
  })

  it('verifies credit note calculations cleanly', () => {
    const lines = [
      {
        qtySold: parseQty('3'),
        qtyAlreadyReturned: parseQty('0'),
        qtyReturn: parseQty('1'),
        originalNet: toMoney(48330),
        originalScAlloc: ZERO,
        originalTaxAlloc: toMoney(5316),
        returnedSoFar: { net: ZERO, sc: ZERO, tax: ZERO },
      },
    ]
    const refund = { method: 'CASH' as const, cashRoundingUnit: 100 as const }
    const cn = calcCreditNote({ lines, priceTaxMode: 'EXCLUSIVE', refund })

    expect(
      verifyCreditNote({ lines, priceTaxMode: 'EXCLUSIVE', refund, stored: cn }),
    ).toEqual({ ok: true, diffs: [] })

    const brokenCn = { ...cn, refundCashApplied: toMoney(17800) }
    const diffRes = verifyCreditNote({
      lines,
      priceTaxMode: 'EXCLUSIVE',
      refund,
      stored: brokenCn,
    })
    expect(diffRes.ok).toBe(false)
    expect(diffRes.diffs).toEqual([
      { path: 'refundCashApplied', expected: 17900, actual: 17800 },
    ])
  })
})
