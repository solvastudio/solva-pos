declare const MoneyBrand: unique symbol

/**
 * Nilai uang dalam satuan rupiah penuh (integer aman `Number.isSafeInteger`).
 * Dilarang perkalian pecahan langsung di modul ini; gunakan `rounding.mulRound`.
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
    throw new MoneyError('UNSAFE', 'Nilai uang tidak hingga atau NaN')
  }
  if (!Number.isInteger(n)) {
    throw new MoneyError('NOT_INTEGER', `Nilai uang harus bilangan bulat, diterima: ${n}`)
  }
  if (!Number.isSafeInteger(n)) {
    throw new MoneyError('UNSAFE', `Nilai uang di luar rentang bilangan bulat aman: ${n}`)
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
    throw new MoneyError('NEGATIVE', `Nilai uang tidak boleh negatif: ${n}`)
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
