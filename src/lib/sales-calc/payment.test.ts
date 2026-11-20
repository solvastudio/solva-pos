import { describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { settlePayments } from './payment'
import { PaymentError } from './types'

describe('sales-calc/payment (BR-PAY-001..005, V-04..V-08, V-11, V-30)', () => {
  const table: Array<{
    id: string
    grandTotal: number
    unit: 0 | 100 | 500 | 1000
    payments: Array<{ methodCode: string; kind: 'CASH' | 'NON_CASH'; amount: number }>
    applied: number[]
    rounding: number
    totalDue: number
    change: number
    cashApplied: number
  }> = [
    {
      id: 'V-04',
      grandTotal: 112476,
      unit: 100,
      payments: [{ methodCode: 'CASH', kind: 'CASH', amount: 150000 }],
      applied: [112500],
      rounding: 24,
      totalDue: 112500,
      change: 37500,
      cashApplied: 112500,
    },
    {
      id: 'V-05',
      grandTotal: 101330,
      unit: 100,
      payments: [{ methodCode: 'CASH', kind: 'CASH', amount: 110000 }],
      applied: [101300],
      rounding: -30,
      totalDue: 101300,
      change: 8700,
      cashApplied: 101300,
    },
    {
      id: 'V-06',
      grandTotal: 135655,
      unit: 100,
      payments: [{ methodCode: 'CASH', kind: 'CASH', amount: 150000 }],
      applied: [135700],
      rounding: 45,
      totalDue: 135700,
      change: 14300,
      cashApplied: 135700,
    },
    {
      id: 'V-07',
      grandTotal: 135068,
      unit: 100,
      payments: [{ methodCode: 'CASH', kind: 'CASH', amount: 150000 }],
      applied: [135100],
      rounding: 32,
      totalDue: 135100,
      change: 14900,
      cashApplied: 135100,
    },
    {
      id: 'V-08',
      grandTotal: 123323,
      unit: 100,
      payments: [{ methodCode: 'CASH', kind: 'CASH', amount: 130000 }],
      applied: [123300],
      rounding: -23,
      totalDue: 123300,
      change: 6700,
      cashApplied: 123300,
    },
    {
      id: 'V-11',
      grandTotal: 135655,
      unit: 100,
      payments: [
        { methodCode: 'QRIS', kind: 'NON_CASH', amount: 100000 },
        { methodCode: 'CASH', kind: 'CASH', amount: 50000 },
      ],
      applied: [100000, 35700],
      rounding: 45,
      totalDue: 135700,
      change: 14300,
      cashApplied: 35700,
    },
    {
      id: 'BR-PAY Contoh 3 (partial cash then non-cash)',
      grandTotal: 135655,
      unit: 100,
      payments: [
        { methodCode: 'CASH', kind: 'CASH', amount: 20000 },
        { methodCode: 'QRIS', kind: 'NON_CASH', amount: 115655 },
      ],
      applied: [20000, 115655],
      rounding: 0,
      totalDue: 135655,
      change: 0,
      cashApplied: 20000,
    },
    {
      id: 'V-30',
      grandTotal: 54945,
      unit: 100,
      payments: [{ methodCode: 'CASH', kind: 'CASH', amount: 60000 }],
      applied: [54900],
      rounding: -45,
      totalDue: 54900,
      change: 5100,
      cashApplied: 54900,
    },
    {
      id: 'unit=0 (no rounding)',
      grandTotal: 112476,
      unit: 0,
      payments: [{ methodCode: 'CASH', kind: 'CASH', amount: 120000 }],
      applied: [112476],
      rounding: 0,
      totalDue: 112476,
      change: 7524,
      cashApplied: 112476,
    },
  ]

  it('settles all payment vectors and rounding examples accurately', () => {
    for (const tc of table) {
      const res = settlePayments({
        grandTotal: toMoney(tc.grandTotal),
        cashRoundingUnit: tc.unit,
        payments: tc.payments.map((p) => ({ ...p, amount: toMoney(p.amount) })),
      })
      expect(
        res.payments.map((p) => p.applied),
        tc.id,
      ).toEqual(tc.applied)
      expect(res.rounding, tc.id).toBe(tc.rounding)
      expect(res.totalDue, tc.id).toBe(tc.totalDue)
      expect(res.changeTotal, tc.id).toBe(tc.change)
      expect(res.cashApplied, tc.id).toBe(tc.cashApplied)
      expect(res.settled, tc.id).toBe(true)
    }
  })

  it('rejects empty, noncash exceeding remaining, underpaid, and invalid order', () => {
    expect(() =>
      settlePayments({ grandTotal: toMoney(10000), cashRoundingUnit: 100, payments: [] }),
    ).toThrowError(PaymentError)

    expect(() =>
      settlePayments({
        grandTotal: toMoney(10000),
        cashRoundingUnit: 100,
        payments: [{ methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(10001) }],
      }),
    ).toThrowError(/exceeds remaining/)

    expect(() =>
      settlePayments({
        grandTotal: toMoney(112476),
        cashRoundingUnit: 100,
        payments: [{ methodCode: 'CASH', kind: 'CASH', amount: toMoney(112400) }],
      }),
    ).toThrowError(/less than rounded due/)

    expect(() =>
      settlePayments({
        grandTotal: toMoney(50000),
        cashRoundingUnit: 100,
        payments: [
          { methodCode: 'CASH', kind: 'CASH', amount: toMoney(60000) },
          { methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(1000) },
        ],
      }),
    ).toThrowError(/final settling payment/)
  })
})
