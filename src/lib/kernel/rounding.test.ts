import { describe, expect, it } from 'vitest'
import { toMoney, ZERO } from './money'
import { D, parseQty } from './qty'
import {
  allocateEqual,
  allocateLR,
  mulRound,
  percentOf,
  proRate,
  ratioRound,
  roundHalfUp,
  roundToUnit,
} from './rounding'

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

  it('rounds cash amounts half-up to 0/100/500/1000 units cleanly', () => {
    expect(roundToUnit(toMoney(112476), 100)).toBe(112500)
    expect(roundToUnit(toMoney(101330), 100)).toBe(101300)
    expect(roundToUnit(toMoney(135655), 100)).toBe(135700)
    expect(roundToUnit(toMoney(135068), 100)).toBe(135100)
    expect(roundToUnit(toMoney(123323), 100)).toBe(123300)
    expect(roundToUnit(toMoney(54945), 100)).toBe(54900)
    expect(roundToUnit(toMoney(350), 100)).toBe(400)
    expect(roundToUnit(toMoney(112476), 0)).toBe(112476)
    expect(roundToUnit(toMoney(1250), 500)).toBe(1500)
    expect(roundToUnit(toMoney(1500), 1000)).toBe(2000)
    expect(() => roundToUnit(toMoney(-10), 100)).toThrowError(RangeError)
  })
})

describe('kernel/proRate (BR-HPP-003, angka V-12..V-16)', () => {
  it('computes R(value×num/den) half-up with a single rounding', () => {
    expect(proRate(toMoney(800000), parseQty('30'), parseQty('100'))).toBe(240000)
    expect(proRate(toMoney(985000), parseQty('7'), parseQty('120'))).toBe(57458)
    expect(proRate(toMoney(985000), parseQty('10'), parseQty('120'))).toBe(82083)
    expect(proRate(toMoney(328333), parseQty('38'), parseQty('40'))).toBe(311916)
    expect(proRate(toMoney(656667), parseQty('3'), parseQty('80'))).toBe(24625)
    expect(proRate(toMoney(656667), parseQty('5'), parseQty('80'))).toBe(41042)
    expect(proRate(toMoney(57458), parseQty('1'), parseQty('7'))).toBe(8208)
    expect(proRate(toMoney(0), parseQty('5'), parseQty('7'))).toBe(0)
  })

  it('symmetric for negative values: R(-x) = -R(x)', () => {
    expect(proRate(toMoney(-985000), parseQty('7'), parseQty('120'))).toBe(-57458)
  })

  it('menolak penyebut nol', () => {
    expect(() => proRate(toMoney(100), parseQty('1'), parseQty('0'))).toThrow()
  })
})
