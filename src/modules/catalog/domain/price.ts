import type { Money } from '~/lib/kernel'

export interface PriceEntryLike {
  skuId: string
  uomId: string
  outletId: string | null
  price: Money
  deleted?: boolean
}

export type PriceResolution =
  | { kind: 'PRICE'; price: Money; source: 'OUTLET' | 'DEFAULT' }
  | { kind: 'OPEN_PRICE'; suggested: Money | null }
  | { kind: 'NO_PRICE' }

/**
 * Resolves unit selling price for `(skuId, uomId, outletId)` without ever multiplying
 * base price by UOM factor (BR-PRC-001/002/007).
 */
export function resolvePrice(input: {
  skuId: string
  uomId: string
  outletId: string
  entries: readonly PriceEntryLike[]
  isOpenPrice: boolean
}): PriceResolution {
  let outletPrice: Money | null = null
  let defaultPrice: Money | null = null

  for (const entry of input.entries) {
    if (entry.deleted) continue
    if (entry.skuId !== input.skuId || entry.uomId !== input.uomId) continue
    if (entry.outletId === input.outletId) {
      outletPrice = entry.price
      break
    }
    if (entry.outletId === null && defaultPrice === null) {
      defaultPrice = entry.price
    }
  }

  if (input.isOpenPrice) {
    return {
      kind: 'OPEN_PRICE',
      suggested: outletPrice ?? defaultPrice,
    }
  }

  if (outletPrice !== null) {
    return { kind: 'PRICE', price: outletPrice, source: 'OUTLET' }
  }
  if (defaultPrice !== null) {
    return { kind: 'PRICE', price: defaultPrice, source: 'DEFAULT' }
  }
  return { kind: 'NO_PRICE' }
}
