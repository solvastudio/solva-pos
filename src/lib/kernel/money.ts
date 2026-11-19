declare const MoneyBrand: unique symbol

/**
 * Monetary value in whole rupiah units (safe integer `Number.isSafeInteger`).
 * Direct fractional multiplication is forbidden in this module; use `rounding.mulRound`.
 */
export type Money = number & { readonly [MoneyBrand]: true }

export type MoneyErrorCode = 'NOT_INTEGER' | 'UNSAFE' | 'NEGATIVE'

export class MoneyError extends Error {
  constructor(
    public readonly code: MoneyErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MoneyError'
  }
}

function assertSafeMoney(n: number): Money {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new MoneyError('UNSAFE', 'Money value is non-finite or NaN')
  }
  if (!Number.isInteger(n)) {
    throw new MoneyError('NOT_INTEGER', `Money value must be an integer, received: ${n}`)
  }
  if (!Number.isSafeInteger(n)) {
    throw new MoneyError('UNSAFE', `Money value is outside the safe integer range: ${n}`)
  }
  return (n === 0 ? 0 : n) as Money
}

export const ZERO: Money = 0 as Money

export function toMoney(n: number): Money {
  return assertSafeMoney(n)
}

export function toNonNegMoney(n: number): Money {
  const m = assertSafeMoney(n)
  if (m < 0) {
    throw new MoneyError('NEGATIVE', `Money value must not be negative: ${n}`)
  }
  return m
}

export function addMoney(a: Money, b: Money): Money {
  return assertSafeMoney(a + b)
}

export function subMoney(a: Money, b: Money): Money {
  return assertSafeMoney(a - b)
}

export function negMoney(a: Money): Money {
  return assertSafeMoney(-a)
}

export function sumMoney(xs: readonly Money[]): Money {
  let acc: Money = ZERO
  for (const x of xs) {
    acc = addMoney(acc, x)
  }
  return acc
}

export function minMoney(a: Money, b: Money): Money {
  return a <= b ? a : b
}

export function maxMoney(a: Money, b: Money): Money {
  return a >= b ? a : b
}
