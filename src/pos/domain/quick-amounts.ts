import { toMoney, type Money } from '~/lib/kernel'

export const OPEN_SHIFT_QUICK_AMOUNTS: readonly Money[] = [
  toMoney(100_000),
  toMoney(200_000),
  toMoney(500_000),
]

const CASH_DENOMS = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000]

/**
 * Generates exact + convenient clean denomination quick-cash buttons >= `totalDue`.
 */
export function computeCashQuickAmounts(totalDue: Money): Money[] {
  const seen = new Set<number>([totalDue])
  for (const step of CASH_DENOMS) {
    if (step > totalDue) {
      seen.add(step)
    } else {
      const roundedUp = Math.ceil(totalDue / step) * step
      if (roundedUp >= totalDue) seen.add(roundedUp)
    }
    if (seen.size >= 4) break
  }
  return [...seen].sort((a, b) => a - b).slice(0, 4).map((v) => toMoney(v))
}
