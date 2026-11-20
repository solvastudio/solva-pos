import { mulRound, percentOf, toMoney, ZERO, type Money, type Qty } from '~/lib/kernel'
import { SalesCalcError, type DiscountInput } from './types'

const PCT_PATTERN = /^\d{1,3}(?:\.\d{1,4})?$/

/**
 * Parses a non-negative `numeric(7,4)` percentage string into integer scale `10^4`
 * (`"100.0000"` -> `1_000_000n`) without using floating point arithmetic.
 */
export function parsePercentScaled4(raw: string): bigint | null {
  if (typeof raw !== 'string' || !PCT_PATTERN.test(raw)) {
    return null
  }
  const dot = raw.indexOf('.')
  const intPart = dot === -1 ? raw : raw.slice(0, dot)
  const fracPart = dot === -1 ? '' : raw.slice(dot + 1)
  const scaled = BigInt(intPart) * 10_000n + BigInt(fracPart.padEnd(4, '0'))
  if (scaled < 0n || scaled > 1_000_000n) {
    return null
  }
  return scaled
}

/**
 * Computes line gross `R(unitPrice * qty)` with single rounding per line (BR-MNY-005).
 */
export function calcLineGross(unitPrice: Money, qty: Qty): Money {
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
    throw new SalesCalcError('INVALID_LINE', `Unit price must be a non-negative integer: ${unitPrice}`)
  }
  try {
    return mulRound(unitPrice, qty)
  } catch (err) {
    throw new SalesCalcError(
      'INVALID_LINE',
      err instanceof Error ? err.message : 'Invalid line qty/unitPrice',
    )
  }
}

/**
 * Computes line or bill discount bounded strictly to `[0, base]` (BR-DSC-002/004).
 */
export function calcLineDiscount(base: Money, discount?: DiscountInput): Money {
  if (!Number.isSafeInteger(base) || base < 0) {
    throw new SalesCalcError('INVALID_DISCOUNT', `Discount base must be >= 0: ${base}`)
  }
  if (!discount) {
    return ZERO
  }
  if (discount.kind === 'PERCENT') {
    if (parsePercentScaled4(discount.percent) === null) {
      throw new SalesCalcError('INVALID_DISCOUNT', `Percentage out of 0..100 range: "${discount.percent}"`)
    }
    const amt = percentOf(base, discount.percent)
    return toMoney(Math.min(amt, base))
  }
  if (
    typeof discount.amount !== 'number' ||
    !Number.isSafeInteger(discount.amount) ||
    discount.amount < 0
  ) {
    throw new SalesCalcError('INVALID_DISCOUNT', `Nominal discount must be integer >= 0: ${discount.amount}`)
  }
  return toMoney(Math.min(discount.amount, base))
}
