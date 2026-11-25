import { describe, expect, it } from 'vitest'
import { computeBillTotals } from './bill-totals'

describe('pos/domain/bill-totals', () => {
  const sampleItems = [
    {
      qty: '2',
      unit_price: 35000,
      taxable: true,
      discount_type: null,
      discount_pct: null,
      discount_input: null,
      status: 'ACTIVE' as const,
    },
    {
      qty: '2',
      unit_price: 8000,
      taxable: true,
      discount_type: null,
      discount_pct: null,
      discount_input: null,
      status: 'ACTIVE' as const,
    },
    {
      qty: '1',
      unit_price: 44500, // 42500 + 2000 modifier
      taxable: true,
      discount_type: null,
      discount_pct: null,
      discount_input: null,
      status: 'ACTIVE' as const,
    },
    {
      qty: '1',
      unit_price: 99999,
      taxable: true,
      discount_type: null,
      discount_pct: null,
      discount_input: null,
      status: 'VOIDED' as const,
    },
  ]

  const sampleBill = {
    bill_discount_type: 'PERCENT' as const,
    bill_discount_pct: '10.0000',
    bill_discount_input: null,
  }

  it('reproduces PRD Contoh 3a (taxable SC = 135.655) and Contoh 3b (non-taxable SC = 135.068) while ignoring VOIDED items', () => {
    const res3a = computeBillTotals({
      bill: sampleBill,
      items: sampleItems,
      cashRoundingUnit: 100,
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PB1',
        taxRate: '10',
        serviceChargeEnabled: true,
        serviceChargeRate: '5',
        serviceChargeTaxable: true,
      },
    })
    expect(res3a.activeItemCount).toBe(3)
    expect(res3a.calc.grossTotal).toBe(130500)
    expect(res3a.calc.billDiscountTotal).toBe(13050)
    expect(res3a.calc.netSubtotal).toBe(117450)
    expect(res3a.calc.serviceCharge).toBe(5873)
    expect(res3a.calc.taxAmount).toBe(12332)
    expect(res3a.calc.grandTotal).toBe(135655)

    const res3b = computeBillTotals({
      bill: sampleBill,
      items: sampleItems,
      cashRoundingUnit: 100,
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PB1',
        taxRate: '10',
        serviceChargeEnabled: true,
        serviceChargeRate: '5',
        serviceChargeTaxable: false,
      },
    })
    expect(res3b.calc.taxAmount).toBe(11745)
    expect(res3b.calc.grandTotal).toBe(135068)
  })
})
