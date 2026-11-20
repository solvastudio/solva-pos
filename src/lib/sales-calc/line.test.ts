import { describe, expect, it } from 'vitest'
import { parseQty, toMoney } from '~/lib/kernel'
import { calcLineDiscount, calcLineGross } from './line'
import { SalesCalcError } from './types'

describe('sales-calc/line', () => {
  it('computes calcLineGross with single half-up rounding per line (BR-MNY-005)', () => {
    expect(calcLineGross(toMoney(12500), parseQty('0.333'))).toBe(4163)
    expect(calcLineGross(toMoney(17900), parseQty('3'))).toBe(53700)
    expect(() => calcLineGross(toMoney(-1), parseQty('1'))).toThrowError(SalesCalcError)
  })

  it('computes percent & nominal discounts clamped to [0, gross] and rejects invalid discounts', () => {
    expect(calcLineDiscount(toMoney(53700))).toBe(0)
    expect(calcLineDiscount(toMoney(53700), { kind: 'PERCENT', percent: '10.0000' })).toBe(5370)
    expect(calcLineDiscount(toMoney(16000), { kind: 'NOMINAL', amount: toMoney(25000) })).toBe(16000)
    expect(() =>
      calcLineDiscount(toMoney(10000), { kind: 'PERCENT', percent: '101.0000' }),
    ).toThrowError(SalesCalcError)
    expect(() =>
      calcLineDiscount(toMoney(10000), { kind: 'PERCENT', percent: '-5' }),
    ).toThrowError(SalesCalcError)
    expect(() =>
      calcLineDiscount(toMoney(10000), { kind: 'NOMINAL', amount: toMoney(-100) }),
    ).toThrowError(SalesCalcError)
  })
})
