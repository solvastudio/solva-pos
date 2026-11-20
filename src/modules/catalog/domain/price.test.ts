import { describe, expect, it } from 'vitest'
import { toNonNegMoney } from '~/lib/kernel'
import { resolvePrice, type PriceEntryLike } from './price'

describe('catalog/domain/price (BR-PRC-002 & BR-PRC-007)', () => {
  const entries: PriceEntryLike[] = [
    {
      skuId: 'sku-susu',
      uomId: 'uom-pcs',
      outletId: null,
      price: toNonNegMoney(11_500),
    },
    {
      skuId: 'sku-susu',
      uomId: 'uom-dus',
      outletId: null,
      price: toNonNegMoney(130_000),
    },
    {
      skuId: 'sku-susu',
      uomId: 'uom-pcs',
      outletId: 'outlet-b',
      price: toNonNegMoney(12_000),
    },
    {
      skuId: 'sku-susu',
      uomId: 'uom-pack',
      outletId: 'outlet-b',
      price: toNonNegMoney(60_000),
      deleted: true,
    },
  ]

  it('resolves explicit UOM pricing directly (no base*factor derivation) and applies outlet override > default', () => {
    // Outlet A falls back to default tenant pricing
    expect(
      resolvePrice({
        skuId: 'sku-susu',
        uomId: 'uom-pcs',
        outletId: 'outlet-a',
        entries,
        isOpenPrice: false,
      }),
    ).toEqual({ kind: 'PRICE', price: 11_500, source: 'DEFAULT' })

    expect(
      resolvePrice({
        skuId: 'sku-susu',
        uomId: 'uom-dus',
        outletId: 'outlet-a',
        entries,
        isOpenPrice: false,
      }),
    ).toEqual({ kind: 'PRICE', price: 130_000, source: 'DEFAULT' })

    // Outlet B sees explicit outlet override
    expect(
      resolvePrice({
        skuId: 'sku-susu',
        uomId: 'uom-pcs',
        outletId: 'outlet-b',
        entries,
        isOpenPrice: false,
      }),
    ).toEqual({ kind: 'PRICE', price: 12_000, source: 'OUTLET' })
  })

  it('returns NO_PRICE when unpriced (even if tombstoned) and never derives from another UOM', () => {
    expect(
      resolvePrice({
        skuId: 'sku-susu',
        uomId: 'uom-pack',
        outletId: 'outlet-b',
        entries,
        isOpenPrice: false,
      }),
    ).toEqual({ kind: 'NO_PRICE' })
  })

  it('returns OPEN_PRICE with optional suggested master price when isOpenPrice=true', () => {
    expect(
      resolvePrice({
        skuId: 'sku-open',
        uomId: 'uom-pcs',
        outletId: 'outlet-a',
        entries,
        isOpenPrice: true,
      }),
    ).toEqual({ kind: 'OPEN_PRICE', suggested: null })

    expect(
      resolvePrice({
        skuId: 'sku-susu',
        uomId: 'uom-pcs',
        outletId: 'outlet-b',
        entries,
        isOpenPrice: true,
      }),
    ).toEqual({ kind: 'OPEN_PRICE', suggested: 12_000 })
  })
})
