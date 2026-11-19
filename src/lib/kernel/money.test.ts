import { describe, expect, it } from 'vitest'
import {
  addMoney,
  maxMoney,
  minMoney,
  MoneyError,
  negMoney,
  subMoney,
  sumMoney,
  toMoney,
  toNonNegMoney,
  ZERO,
} from './money'

describe('kernel/money', () => {
  it('accepts safe integers and normalizes -0 to 0', () => {
    expect(ZERO).toBe(0)
    expect(toMoney(12500)).toBe(12500)
    expect(toMoney(-500)).toBe(-500)
    expect(Object.is(toMoney(-0), 0)).toBe(true)
    expect(toNonNegMoney(0)).toBe(0)
    expect(toNonNegMoney(1000)).toBe(1000)
  })

  it('rejects floats, NaN, Infinity, and numbers outside the safe range', () => {
    expect(() => toMoney(12.5)).toThrowError(MoneyError)
    expect(() => toMoney(12.5)).toThrowError(expect.objectContaining({ code: 'NOT_INTEGER' }))
    expect(() => toMoney(Number.NaN)).toThrowError(expect.objectContaining({ code: 'UNSAFE' }))
    expect(() => toMoney(Number.POSITIVE_INFINITY)).toThrowError(
      expect.objectContaining({ code: 'UNSAFE' }),
    )
    expect(() => toMoney(Number.MAX_SAFE_INTEGER + 1)).toThrowError(
      expect.objectContaining({ code: 'UNSAFE' }),
    )
    expect(() => toNonNegMoney(-1)).toThrowError(expect.objectContaining({ code: 'NEGATIVE' }))
  })

  it('performs safe arithmetic and detects safe-integer overflow', () => {
    const a = toMoney(10000)
    const b = toMoney(2500)
    expect(addMoney(a, b)).toBe(12500)
    expect(subMoney(a, b)).toBe(7500)
    expect(subMoney(b, a)).toBe(-7500)
    expect(negMoney(a)).toBe(-10000)
    expect(sumMoney([a, b, toMoney(500)])).toBe(13000)
    expect(sumMoney([])).toBe(0)
    expect(minMoney(a, b)).toBe(2500)
    expect(maxMoney(a, b)).toBe(10000)

    const maxSafe = toMoney(Number.MAX_SAFE_INTEGER)
    expect(() => addMoney(maxSafe, toMoney(1))).toThrowError(
      expect.objectContaining({ code: 'UNSAFE' }),
    )
    expect(() => subMoney(toMoney(Number.MIN_SAFE_INTEGER), toMoney(1))).toThrowError(
      expect.objectContaining({ code: 'UNSAFE' }),
    )
  })
})
