import { describe, expect, it } from 'vitest'
import { toMoney, ZERO } from '~/lib/kernel'
import { previewPayments } from './payment-preview'

describe('pos/domain/payment-preview (V-04, V-05, V-11, BR-PAY Ex 3)', () => {
  it('computes V-04 cash 150,000 -> applied 112,500, rounding +24, change 37,500', () => {
    const res = previewPayments({
      grandTotal: toMoney(112_476),
      cashRoundingUnit: 100,
      payments: [{ methodCode: 'CASH', kind: 'CASH', amount: toMoney(150_000) }],
    })
    expect(res.canFinalize).toBe(true)
    expect(res.remaining).toBe(0)
    expect(res.settlement?.rounding).toBe(24)
    expect(res.settlement?.totalDue).toBe(112_500)
    expect(res.settlement?.changeTotal).toBe(37_500)
  })

  it('computes V-11 QRIS 100,000 + Cash 50,000 -> cash applied 35,700, rounding +45, change 14,300', () => {
    const partial = previewPayments({
      grandTotal: toMoney(135_655),
      cashRoundingUnit: 100,
      payments: [{ methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(100_000) }],
    })
    expect(partial.canFinalize).toBe(false)
    expect(partial.error).toBe('UNDERPAID')
    expect(partial.remaining).toBe(35_655)

    const settled = previewPayments({
      grandTotal: toMoney(135_655),
      cashRoundingUnit: 100,
      payments: [
        { methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(100_000) },
        { methodCode: 'CASH', kind: 'CASH', amount: toMoney(50_000) },
      ],
    })
    expect(settled.canFinalize).toBe(true)
    expect(settled.settlement?.rounding).toBe(45)
    expect(settled.settlement?.cashApplied).toBe(35_700)
    expect(settled.settlement?.changeTotal).toBe(14_300)
  })

  it('computes BR-PAY Ex 3 Cash 20,000 + QRIS 115,655 -> rounding 0 and V-05 rounding 0 when unit=0', () => {
    const ex3 = previewPayments({
      grandTotal: toMoney(135_655),
      cashRoundingUnit: 100,
      payments: [
        { methodCode: 'CASH', kind: 'CASH', amount: toMoney(20_000) },
        { methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(115_655) },
      ],
    })
    expect(ex3.canFinalize).toBe(true)
    expect(ex3.settlement?.rounding).toBe(0)
    expect(ex3.settlement?.changeTotal).toBe(0)

    const v05 = previewPayments({
      grandTotal: toMoney(135_655),
      cashRoundingUnit: 0,
      payments: [{ methodCode: 'CASH', kind: 'CASH', amount: toMoney(150_000) }],
    })
    expect(v05.canFinalize).toBe(true)
    expect(v05.settlement?.rounding).toBe(0)
    expect(v05.settlement?.changeTotal).toBe(14_345)
  })

  it('blocks non-cash exceeding remaining balance cleanly', () => {
    const res = previewPayments({
      grandTotal: toMoney(100_000),
      cashRoundingUnit: 100,
      payments: [
        { methodCode: 'CASH', kind: 'CASH', amount: toMoney(40_000) },
        { methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(70_000) },
      ],
    })
    expect(res.canFinalize).toBe(false)
    expect(res.error).toBe('NONCASH_EXCEEDS_REMAINING')
    expect(res.remaining).toBe(ZERO)
  })
})
