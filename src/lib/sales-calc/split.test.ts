import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseQty, toMoney } from '~/lib/kernel'
import { calcEqualSplit, calcGroupSplit } from './split'
import { SPLIT_CALC_VECTORS } from './sales-calc.vectors'
import { SalesCalcError, type SaleConfigSnapshot } from './types'

describe('sales-calc/split (V-19, V-20 & LR conservation invariants)', () => {
  it('matches V-19 and V-20 canonical split vectors', () => {
    for (const v of SPLIT_CALC_VECTORS) {
      if (v.mode === 'EQUAL') {
        const res = calcEqualSplit(v.input, v.shareCount!)
        expect(res.shares).toHaveLength(v.expectedChildren.length)
        res.shares.forEach((share, idx) => {
          const exp = v.expectedChildren[idx]!
          if (exp.netSubtotal !== undefined) expect(share.calc.netSubtotal, `${v.id}[${idx}]`).toBe(exp.netSubtotal)
          if (exp.serviceCharge !== undefined) expect(share.calc.serviceCharge, `${v.id}[${idx}]`).toBe(exp.serviceCharge)
          if (exp.taxBase !== undefined) expect(share.calc.taxBase, `${v.id}[${idx}]`).toBe(exp.taxBase)
          if (exp.taxAmount !== undefined) expect(share.calc.taxAmount, `${v.id}[${idx}]`).toBe(exp.taxAmount)
          if (exp.dpp !== undefined) expect(share.calc.dpp, `${v.id}[${idx}]`).toBe(exp.dpp)
          if (exp.grandTotal !== undefined) expect(share.calc.grandTotal, `${v.id}[${idx}]`).toBe(exp.grandTotal)
        })
      } else {
        const res = calcGroupSplit(v.input, v.itemGroups!)
        expect(res.children).toHaveLength(v.expectedChildren.length)
        res.children.forEach((child, idx) => {
          const exp = v.expectedChildren[idx]!
          if (exp.netSubtotal !== undefined) expect(child.netSubtotal, `${v.id}[${idx}]`).toBe(exp.netSubtotal)
          if (exp.serviceCharge !== undefined) expect(child.serviceCharge, `${v.id}[${idx}]`).toBe(exp.serviceCharge)
          if (exp.taxBase !== undefined) expect(child.taxBase, `${v.id}[${idx}]`).toBe(exp.taxBase)
          if (exp.taxAmount !== undefined) expect(child.taxAmount, `${v.id}[${idx}]`).toBe(exp.taxAmount)
          if (exp.dpp !== undefined) expect(child.dpp, `${v.id}[${idx}]`).toBe(exp.dpp)
          if (exp.grandTotal !== undefined) expect(child.grandTotal, `${v.id}[${idx}]`).toBe(exp.grandTotal)
        })
      }
    }
  })

  it('rejects shareCount < 2 and empty group splits', () => {
    const cfg: SaleConfigSnapshot = {
      priceTaxMode: 'EXCLUSIVE',
      taxProfile: 'NONE',
      taxRate: '0',
      serviceChargeEnabled: false,
      serviceChargeRate: '0',
      serviceChargeTaxable: true,
    }
    const baseInput = {
      lines: [
        { lineNo: 1, skuId: 's1', uomId: 'u1', qty: parseQty('1'), unitPrice: toMoney(10000), taxable: true },
      ],
      config: cfg,
    }
    expect(() => calcEqualSplit(baseInput, 1)).toThrow(SalesCalcError)
    expect(() => calcGroupSplit(baseInput, [baseInput.lines])).toThrow(SalesCalcError)
    expect(() => calcGroupSplit(baseInput, [baseInput.lines, []])).toThrow(SalesCalcError)
  })

  it('property: calcEqualSplit preserves exact sum across all shares and diff <= 1 Rp', () => {
    const modeArb = fc.constantFrom<'INCLUSIVE' | 'EXCLUSIVE'>('INCLUSIVE', 'EXCLUSIVE')
    const scTaxableArb = fc.boolean()

    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 500000 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 2, max: 12 }),
        modeArb,
        scTaxableArb,
        (unitPrice, qtyNum, shareCount, priceTaxMode, serviceChargeTaxable) => {
          const input = {
            lines: [
              {
                lineNo: 1,
                skuId: 's1',
                uomId: 'u1',
                qty: parseQty(String(qtyNum)),
                unitPrice: toMoney(unitPrice),
                taxable: true,
              },
            ],
            config: {
              priceTaxMode,
              taxProfile: 'PB1' as const,
              taxRate: '10.0000',
              serviceChargeEnabled: true,
              serviceChargeRate: '5.0000',
              serviceChargeTaxable,
            },
          }
          const res = calcEqualSplit(input, shareCount)
          const sum = (pick: (c: (typeof res.shares)[number]['calc']) => number) =>
            res.shares.reduce((acc, s) => acc + pick(s.calc), 0)

          expect(sum((c) => c.grossTotal)).toBe(res.parent.grossTotal)
          expect(sum((c) => c.netSubtotal)).toBe(res.parent.netSubtotal)
          expect(sum((c) => c.serviceCharge)).toBe(res.parent.serviceCharge)
          expect(sum((c) => c.taxBase)).toBe(res.parent.taxBase)
          expect(sum((c) => c.taxAmount)).toBe(res.parent.taxAmount)
          expect(sum((c) => c.dpp)).toBe(res.parent.dpp)
          expect(sum((c) => c.grandTotal)).toBe(res.parent.grandTotal)

          const totals = res.shares.map((s) => s.calc.grandTotal)
          expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 100 },
    )
  })
})
