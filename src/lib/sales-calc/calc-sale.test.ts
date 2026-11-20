import { describe, expect, it } from 'vitest'
import { parseQty, toMoney } from '~/lib/kernel'
import { calcSale } from './calc-sale'
import { settlePayments } from './payment'
import { SALES_CALC_VECTORS } from './sales-calc.vectors'
import { SalesCalcError } from './types'

describe('sales-calc/calcSale (V-04..V-09, V-30 & edge cases)', () => {
  it('matches every canonical accounting test vector cleanly', () => {
    for (const v of SALES_CALC_VECTORS) {
      const res = calcSale(v.input)
      if (v.expected.grossTotal !== undefined) expect(res.grossTotal, v.id).toBe(v.expected.grossTotal)
      if (v.expected.lineDiscountTotal !== undefined)
        expect(res.lineDiscountTotal, v.id).toBe(v.expected.lineDiscountTotal)
      if (v.expected.billDiscountTotal !== undefined)
        expect(res.billDiscountTotal, v.id).toBe(v.expected.billDiscountTotal)
      if (v.expected.netSubtotal !== undefined)
        expect(res.netSubtotal, v.id).toBe(v.expected.netSubtotal)
      if (v.expected.serviceCharge !== undefined)
        expect(res.serviceCharge, v.id).toBe(v.expected.serviceCharge)
      if (v.expected.taxBase !== undefined) expect(res.taxBase, v.id).toBe(v.expected.taxBase)
      if (v.expected.taxAmount !== undefined) expect(res.taxAmount, v.id).toBe(v.expected.taxAmount)
      if (v.expected.dpp !== undefined) expect(res.dpp, v.id).toBe(v.expected.dpp)
      if (v.expected.grandTotal !== undefined)
        expect(res.grandTotal, v.id).toBe(v.expected.grandTotal)

      if (v.expected.lineGrosses) {
        expect(
          res.lines.map((l) => l.lineGross),
          v.id,
        ).toEqual(v.expected.lineGrosses)
      }
      if (v.expected.lineDiscounts) {
        expect(
          res.lines.map((l) => l.lineDiscount),
          v.id,
        ).toEqual(v.expected.lineDiscounts)
      }
      if (v.expected.taxAllocs) {
        expect(
          res.lines.map((l) => l.taxAlloc),
          v.id,
        ).toEqual(v.expected.taxAllocs)
      }
      if (v.settlement) {
        const s = settlePayments({
          grandTotal: res.grandTotal,
          cashRoundingUnit: v.settlement.cashRoundingUnit,
          payments: v.settlement.payments,
        })
        expect(s.rounding, `${v.id} rounding`).toBe(v.settlement.expected.rounding)
        expect(s.totalDue, `${v.id} totalDue`).toBe(v.settlement.expected.totalDue)
        expect(s.changeTotal, `${v.id} changeTotal`).toBe(v.settlement.expected.changeTotal)
        expect(
          s.payments.map((p) => p.applied),
          `${v.id} applied`,
        ).toEqual(v.settlement.expected.applied)
      }
    }
  })

  it('excludes non-taxable items from taxBase & taxAlloc, handles taxProfile=NONE, and clamps excess nominal discount', () => {
    // Non-taxable line keeps taxAlloc = 0 even when SC is taxable on mixed cart
    const mixedTax = calcSale({
      lines: [
        { lineNo: 1, skuId: 's1', uomId: 'u1', qty: parseQty('1'), unitPrice: toMoney(50000), taxable: true },
        { lineNo: 2, skuId: 's2', uomId: 'u1', qty: parseQty('1'), unitPrice: toMoney(50000), taxable: false },
      ],
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11.0000',
        serviceChargeEnabled: false,
        serviceChargeRate: '0.0000',
        serviceChargeTaxable: false,
      },
    })
    expect(mixedTax.taxBase).toBe(50000)
    expect(mixedTax.taxAmount).toBe(5500)
    expect(mixedTax.lines.map((l) => l.taxAlloc)).toEqual([5500, 0])

    // All non-taxable items + taxable SC -> sum tax weights = 0 => taxAmount = 0, taxAlloc = 0
    const allNonTax = calcSale({
      lines: [
        { lineNo: 1, skuId: 's1', uomId: 'u1', qty: parseQty('1'), unitPrice: toMoney(40000), taxable: false },
      ],
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11.0000',
        serviceChargeEnabled: true,
        serviceChargeRate: '5.0000',
        serviceChargeTaxable: true,
      },
    })
    expect(allNonTax.serviceCharge).toBe(2000)
    expect(allNonTax.taxAmount).toBe(0)
    expect(allNonTax.lines[0]?.taxAlloc).toBe(0)
    expect(allNonTax.grandTotal).toBe(42000)

    // taxProfile = 'NONE' -> tax 0, G = S2 + SC
    const noTaxProfile = calcSale({
      lines: [
        { lineNo: 1, skuId: 's1', uomId: 'u1', qty: parseQty('1'), unitPrice: toMoney(30000), taxable: true },
      ],
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'NONE',
        taxRate: '0.0000',
        serviceChargeEnabled: true,
        serviceChargeRate: '10.0000',
        serviceChargeTaxable: true,
      },
    })
    expect(noTaxProfile.taxAmount).toBe(0)
    expect(noTaxProfile.grandTotal).toBe(33000)

    // Excess nominal discount clamps cleanly to basis -> lineNet=0, S1>=0, S2>=0
    const clamped = calcSale({
      lines: [
        {
          lineNo: 1,
          skuId: 's1',
          uomId: 'u1',
          qty: parseQty('1'),
          unitPrice: toMoney(20000),
          taxable: true,
          discount: { kind: 'NOMINAL', amount: toMoney(99000) },
        },
        {
          lineNo: 2,
          skuId: 's2',
          uomId: 'u1',
          qty: parseQty('1'),
          unitPrice: toMoney(10000),
          taxable: true,
        },
      ],
      billDiscount: { kind: 'NOMINAL', amount: toMoney(50000) },
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11.0000',
        serviceChargeEnabled: false,
        serviceChargeRate: '0.0000',
        serviceChargeTaxable: true,
      },
    })
    expect(clamped.lines[0]?.lineDiscount).toBe(20000)
    expect(clamped.lines[0]?.lineNet).toBe(0)
    expect(clamped.billDiscountTotal).toBe(10000)
    expect(clamped.netSubtotal).toBe(0)
    expect(clamped.grandTotal).toBe(0)
  })

  it('rejects empty cart and invalid/duplicate line numbers cleanly', () => {
    expect(() =>
      calcSale({
        lines: [],
        config: {
          priceTaxMode: 'EXCLUSIVE',
          taxProfile: 'NONE',
          taxRate: '0.0000',
          serviceChargeEnabled: false,
          serviceChargeRate: '0.0000',
          serviceChargeTaxable: true,
        },
      }),
    ).toThrowError(SalesCalcError)

    expect(() =>
      calcSale({
        lines: [
          { lineNo: 1, skuId: 'a', uomId: 'u', qty: parseQty('1'), unitPrice: toMoney(1000), taxable: true },
          { lineNo: 1, skuId: 'b', uomId: 'u', qty: parseQty('1'), unitPrice: toMoney(2000), taxable: true },
        ],
        config: {
          priceTaxMode: 'EXCLUSIVE',
          taxProfile: 'NONE',
          taxRate: '0.0000',
          serviceChargeEnabled: false,
          serviceChargeRate: '0.0000',
          serviceChargeTaxable: true,
        },
      }),
    ).toThrowError(SalesCalcError)
  })
})
