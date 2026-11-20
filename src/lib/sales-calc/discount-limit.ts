import type { Money } from '~/lib/kernel'
import { parsePercentScaled4 } from './line'
import { SalesCalcError } from './types'

export interface CheckDiscountLimitInput {
  lines: readonly { lineGross: Money; lineDiscount: Money }[]
  billDiscount: Money
  s1: Money
  roleLimitPct: string
}

export interface CheckDiscountLimitResult {
  requestedPct: string
  needsApproval: boolean
  breakdown: {
    perLineMaxPct: string
    billPct: string
    cumulativePct: string
  }
}

/**
 * Compares `discount / basis > limitPct / 100` purely in exact `bigint` arithmetic:
 * `discount * 1_000_000 > limitScaled4 * basis`.
 */
function exceedsPercentLimit(discount: number, basis: number, limitScaled4: bigint): boolean {
  if (discount <= 0) return false
  if (basis <= 0) return true
  return BigInt(discount) * 1_000_000n > limitScaled4 * BigInt(basis)
}

/**
 * Formats `(discount / basis) * 100` to 3 decimal places using half-up `bigint` rounding.
 */
function formatPercent3(discount: number, basis: number): string {
  if (discount <= 0 || basis <= 0) {
    return '0.000'
  }
  const d = BigInt(discount)
  const b = BigInt(basis)
  // percentage * 1000 = (discount * 100 * 1000) / basis
  const scaled = d * 100_000n
  const q = scaled / b
  const r = scaled % b
  const rounded = r * 2n >= b ? q + 1n : q
  const whole = rounded / 1000n
  const frac = (rounded % 1000n).toString().padStart(3, '0')
  return `${whole}.${frac}`
}

/**
 * Checks two-tier discount approval policy (BR-DSC-003, V-10):
 * both individual discounts (line vs lineGross, bill vs S1) AND cumulative
 * `(sum lineDiscount + billDiscount) / sum lineGross` are checked against `roleLimitPct`.
 */
export function checkDiscountLimit(input: CheckDiscountLimitInput): CheckDiscountLimitResult {
  const limitScaled4 = parsePercentScaled4(input.roleLimitPct)
  if (limitScaled4 === null) {
    throw new SalesCalcError(
      'INVALID_DISCOUNT',
      `Invalid role discount limit percentage: "${input.roleLimitPct}"`,
    )
  }

  let totalLineGross = 0
  let totalLineDiscount = 0
  let maxLineDiscount = 0
  let maxLineBasis = 0
  let anyLineExceeds = false

  for (const line of input.lines) {
    totalLineGross += line.lineGross
    totalLineDiscount += line.lineDiscount
    if (exceedsPercentLimit(line.lineDiscount, line.lineGross, limitScaled4)) {
      anyLineExceeds = true
    }
    if (
      line.lineGross > 0 &&
      (maxLineBasis === 0 ||
        BigInt(line.lineDiscount) * BigInt(maxLineBasis) >
          BigInt(maxLineDiscount) * BigInt(line.lineGross))
    ) {
      maxLineDiscount = line.lineDiscount
      maxLineBasis = line.lineGross
    }
  }

  const billExceeds = exceedsPercentLimit(input.billDiscount, input.s1, limitScaled4)
  const cumulativeDiscount = totalLineDiscount + input.billDiscount
  const cumulativeExceeds = exceedsPercentLimit(cumulativeDiscount, totalLineGross, limitScaled4)

  const candidates: Array<{ disc: number; basis: number; formatted: string }> = [
    {
      disc: maxLineDiscount,
      basis: maxLineBasis,
      formatted: formatPercent3(maxLineDiscount as Money, maxLineBasis as Money),
    },
    {
      disc: input.billDiscount,
      basis: input.s1,
      formatted: formatPercent3(input.billDiscount, input.s1),
    },
    {
      disc: cumulativeDiscount,
      basis: totalLineGross,
      formatted: formatPercent3(cumulativeDiscount as Money, totalLineGross as Money),
    },
  ]

  let highest = candidates[2]!
  for (const cand of candidates) {
    if (cand.basis <= 0) continue
    if (
      highest.basis <= 0 ||
      BigInt(cand.disc) * BigInt(highest.basis) > BigInt(highest.disc) * BigInt(cand.basis)
    ) {
      highest = cand
    }
  }

  return {
    requestedPct: highest.formatted,
    needsApproval: anyLineExceeds || billExceeds || cumulativeExceeds,
    breakdown: {
      perLineMaxPct: candidates[0]!.formatted,
      billPct: candidates[1]!.formatted,
      cumulativePct: candidates[2]!.formatted,
    },
  }
}
