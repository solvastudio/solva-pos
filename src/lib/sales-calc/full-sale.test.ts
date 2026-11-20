import { describe, expect, it } from 'vitest'
import { parseQty, toMoney } from '~/lib/kernel'
import { calcAndSettle } from './full-sale'
import { SALES_CALC_VECTORS } from './sales-calc.vectors'

describe('sales-calc/full-sale', () => {
  it('composes calcSale + settlePayments cleanly on mixed V-11 payment order', () => {
    const v06 = SALES_CALC_VECTORS.find((v) => v.id === 'V-06')!
    const { calc, settlement } = calcAndSettle(
      v06.input,
      [
        { methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(100000) },
        { methodCode: 'CASH', kind: 'CASH', amount: toMoney(50000) },
      ],
      100,
    )
    expect(calc.grandTotal).toBe(135655)
    expect(settlement.rounding).toBe(45)
    expect(settlement.totalDue).toBe(135700)
    expect(settlement.cashApplied).toBe(35700)
    expect(settlement.changeTotal).toBe(14300)
  })

  it('works cleanly with inclusive single cash tender', () => {
    const { calc, settlement } = calcAndSettle(
      {
        lines: [
          { lineNo: 1, skuId: 's1', uomId: 'u1', qty: parseQty('1'), unitPrice: toMoney(50330), taxable: true },
        ],
        config: {
          priceTaxMode: 'INCLUSIVE',
          taxProfile: 'PPN',
          taxRate: '11.0000',
          serviceChargeEnabled: false,
          serviceChargeRate: '0.0000',
          serviceChargeTaxable: true,
        },
      },
      [{ methodCode: 'CASH', kind: 'CASH', amount: toMoney(51000) }],
      100,
    )
    expect(calc.grandTotal).toBe(50330)
    expect(settlement.rounding).toBe(-30)
    expect(settlement.totalDue).toBe(50300)
  })
})
