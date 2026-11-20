import { describe, expect, it } from 'vitest'
import { toMoney, ZERO } from '~/lib/kernel'
import { checkDiscountLimit } from './discount-limit'
import { SalesCalcError } from './types'

describe('sales-calc/discount-limit (BR-DSC-003, V-10)', () => {
  it('verifies V-10 exact integer comparison and cumulative checks', () => {
    // 7,000 / 130,500 = 5.36398% -> "5.364", exceeds 5% cashier limit -> needs approval
    const overLine = checkDiscountLimit({
      lines: [{ lineGross: toMoney(130500), lineDiscount: toMoney(7000) }],
      billDiscount: ZERO,
      s1: toMoney(123500),
      roleLimitPct: '5.0000',
    })
    expect(overLine.requestedPct).toBe('5.364')
    expect(overLine.needsApproval).toBe(true)

    // 6,000 / 130,500 = 4.59770% -> "4.598", within 5% cashier limit -> allowed
    const underLine = checkDiscountLimit({
      lines: [{ lineGross: toMoney(130500), lineDiscount: toMoney(6000) }],
      billDiscount: ZERO,
      s1: toMoney(124500),
      roleLimitPct: '5.0000',
    })
    expect(underLine.requestedPct).toBe('4.598')
    expect(underLine.needsApproval).toBe(false)

    // Cumulative V-10: per-line 3,500 (<5%) + bill 3,810 (on S1 127,000 = 3% <5%) -> cumulative 5.602% > 5%
    const cumCashier = checkDiscountLimit({
      lines: [{ lineGross: toMoney(130500), lineDiscount: toMoney(3500) }],
      billDiscount: toMoney(3810),
      s1: toMoney(127000),
      roleLimitPct: '5.0000',
    })
    expect(cumCashier.breakdown.billPct).toBe('3.000')
    expect(cumCashier.breakdown.cumulativePct).toBe('5.602')
    expect(cumCashier.needsApproval).toBe(true)

    // Supervisor 20% allows the same cumulative discount cleanly
    const cumSupervisor = checkDiscountLimit({
      lines: [{ lineGross: toMoney(130500), lineDiscount: toMoney(3500) }],
      billDiscount: toMoney(3810),
      s1: toMoney(127000),
      roleLimitPct: '20.0000',
    })
    expect(cumSupervisor.needsApproval).toBe(false)
  })

  it('rejects invalid role limit strings cleanly', () => {
    expect(() =>
      checkDiscountLimit({
        lines: [{ lineGross: toMoney(10000), lineDiscount: ZERO }],
        billDiscount: ZERO,
        s1: toMoney(10000),
        roleLimitPct: '150',
      }),
    ).toThrowError(SalesCalcError)
  })
})
