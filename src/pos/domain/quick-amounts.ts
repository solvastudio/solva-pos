import { toMoney, type Money } from '~/lib/kernel'

export const OPEN_SHIFT_QUICK_AMOUNTS: readonly Money[] = [
  toMoney(100_000),
  toMoney(200_000),
  toMoney(500_000),
]

const QUICK_CASH_STEPS = [5_000, 10_000, 50_000, 100_000]

/**
 * Suggests exact payment + up to 3 clean higher denominations (multiples of 5k / 10k / 50k / 100k)
 * per CMP-31 (`Uang pas` button, i.e. exact amount, + 3 nearest ceilings above `remaining`).
 */
export function suggestCashAmounts(remaining: Money): Money[] {
  if (!Number.isSafeInteger(remaining) || remaining <= 0) {
    return []
  }
  const exact = remaining as number
  const candidates = new Set<number>()
  for (const step of QUICK_CASH_STEPS) {
    const rounded = Math.ceil(exact / step) * step
    if (rounded > exact) {
      candidates.add(rounded)
    }
  }
  if (candidates.size < 3) {
    for (const step of QUICK_CASH_STEPS) {
      const next = Math.ceil(exact / step) * step + step
      if (next > exact) candidates.add(next)
    }
  }
  const higher = [...candidates].sort((a, b) => a - b).slice(0, 3)
  return [exact, ...higher].map((v) => toMoney(v))
}
