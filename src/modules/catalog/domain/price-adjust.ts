import { D, percentOf, toMoney, type Money } from '~/lib/kernel'

const NORMALIZED_PERCENT_RE = /^-?\d+(?:\.\d{1,4})?$/

/**
 * Normalizes comma decimal separators (e.g. `"2,7"` -> `"2.7"`) and adjusts `price` by
 * `percent` using kernel half-up rounding (`price + percentOf(price, pct)`), clamped at 0
 * so selling prices never become negative.
 */
export function increasePricePercent(price: number, rawPercent: string): number {
  const safePrice = toMoney(price)
  if (safePrice < 0) {
    throw new RangeError(`Price must be non-negative: ${price}`)
  }
  const normalized = rawPercent.trim().replace(',', '.')
  if (!NORMALIZED_PERCENT_RE.test(normalized)) {
    throw new RangeError(`Invalid percentage format: "${rawPercent}"`)
  }
  const delta: Money = percentOf(safePrice, normalized)
  const adjusted = new D(safePrice).plus(delta).toNumber()
  return Math.max(0, toMoney(adjusted))
}

export interface PriceEntryPairLike {
  skuId: string
  uomId: string
  outletId: string | null
  price: number
}

/**
 * Pure helper copying prices from `fromOutletId` (`null` = default tenant) for every matching
 * `(skuId, uomId)` key, returning a map of `${skuId}:${uomId}` -> integer rupiah price.
 */
export function copyPrices(
  entries: readonly PriceEntryPairLike[],
  fromOutletId: string | null,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const entry of entries) {
    if (entry.outletId === fromOutletId) {
      out.set(`${entry.skuId}:${entry.uomId}`, toMoney(entry.price))
    }
  }
  return out
}
