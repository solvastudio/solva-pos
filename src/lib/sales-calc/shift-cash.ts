import { toMoney, type Money } from '~/lib/kernel'
import type { ExpectedCashInput } from './types'

function sumSafe(values: readonly Money[]): number {
  let total = 0
  for (const v of values) {
    total += v
  }
  return total
}

/**
 * Computes `expected_cash` for a cashier shift (BR-SHF-005, V-21):
 * `openingFloat + sum(cashSalesApplied) + sum(cashIn) - sum(cashOut) - sum(cashRefunds)`.
 * Callers must exclude `VOID` invoices from `cashSalesApplied`.
 */
export function expectedCash(input: ExpectedCashInput): Money {
  return toMoney(
    input.openingFloat +
      sumSafe(input.cashSalesApplied) +
      sumSafe(input.cashIn) -
      sumSafe(input.cashOut) -
      sumSafe(input.cashRefunds),
  )
}

/**
 * Computes `variance = counted - expected` (negative = cash shortage).
 */
export function cashVariance(counted: Money, expected: Money): Money {
  return toMoney(counted - expected)
}
