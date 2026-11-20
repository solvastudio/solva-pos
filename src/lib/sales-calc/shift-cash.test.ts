import { describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { cashVariance, expectedCash } from './shift-cash'

describe('sales-calc/shift-cash (BR-SHF-005, V-21)', () => {
  it('computes V-21 expectedCash and variance identically to PRD §7.7', () => {
    const exp = expectedCash({
      openingFloat: toMoney(500000),
      cashSalesApplied: [toMoney(1250000)],
      cashIn: [toMoney(200000)],
      cashOut: [toMoney(150000)],
      cashRefunds: [toMoney(17900)],
    })
    expect(exp).toBe(1782100)
    expect(cashVariance(toMoney(1780000), exp)).toBe(-2100)
  })
})
