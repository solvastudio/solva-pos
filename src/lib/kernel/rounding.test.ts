import { describe, expect, it } from 'vitest'
import { toMoney, ZERO } from './money'
import { D, parseQty } from './qty'
import { allocateEqual, allocateLR, mulRound, percentOf, ratioRound, roundHalfUp } from './rounding'

const V01_MUL_CASES = [
  { id: 'V-01a', unit: 12500, qty: '0.333', expected: 4163 },
  { id: 'V-01b', unit: 9999, qty: '1.5', expected: 14999 },
  { id: 'extra-mul', unit: 47500, qty: '0.35', expected: 16625 },
] as const

const PERCENT_CASES = [
  { id: 'extra-5pct', base: 117450, percent: '5.0000', expected: 5873 },
  { id: 'extra-10pct', base: 123323, percent: '10.0000', expected: 12332 },
] as const

describe('kernel/rounding (V-01, V-02, V-03)', () => {
  it('satisfies V-01 and extra cases for mulRound / roundHalfUp / percentOf', () => {
    for (const c of V01_MUL_CASES) {
      expect(mulRound(toMoney(c.unit), parseQty(c.qty)), c.id).toBe(c.expected)
    }

    expect(roundHalfUp(new D('5872.5'))).toBe(5873)
    expect(roundHalfUp(new D('-5872.5'))).toBe(-5873)
    expect(roundHalfUp(new D('-0.4'))).toBe(0)

    for (const c of PERCENT_CASES) {
      expect(percentOf(toMoney(c.base), c.percent), c.id).toBe(c.expected)
    }
  })

  it('satisfies V-02: allocateEqual(100000, 3) -> [33334, 33333, 33333]', () => {
    expect(allocateEqual(toMoney(100000), 3)).toEqual([33334, 33333, 33333])
  })

  it('satisfies V-03: allocateLR(10000, [70000, 16000, 44500]) -> [5364, 1226, 3410]', () => {
    expect(allocateLR(toMoney(10000), [70000, 16000, 44500])).toEqual([5364, 1226, 3410])
  })

  it('handles LR edge cases: total=0, weights containing 0, and rejects invalid inputs', () => {
    expect(allocateLR(ZERO, [10, 20])).toEqual([0, 0])
    expect(allocateLR(toMoney(5), [0, 1, 1])).toEqual([0, 3, 2])
    expect(() => allocateLR(toMoney(-100), [1, 1])).toThrowError(RangeError)
    expect(() => allocateLR(toMoney(100), [])).toThrowError(RangeError)
    expect(() => allocateLR(toMoney(100), [0, 0])).toThrowError(RangeError)
    expect(() => allocateEqual(toMoney(100), 0)).toThrowError(RangeError)
  })

  it('computes ratioRound accurately for inclusive tax extraction and rejects invalid ratios', () => {
    expect(ratioRound(toMoney(101330), '11', '111')).toBe(10042)
    expect(ratioRound(toMoney(123323), '10', '110')).toBe(11211)
    expect(ratioRound(ZERO, '11', '111')).toBe(0)
    expect(ratioRound(toMoney(10000), '0', '100')).toBe(0)
    expect(() => ratioRound(toMoney(-1), '10', '110')).toThrowError(RangeError)
    expect(() => ratioRound(toMoney(100), '10', '0')).toThrowError(RangeError)
    expect(() => ratioRound(toMoney(100), '-5', '100')).toThrowError(RangeError)
  })
})
