import { afterEach, describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { createCatalogScanDeps, searchProducts } from '../../data/catalog.repo'
import { stagePullRows } from '../../data/pull-stage.repo'
import { clearCatalogIndexCache } from '../../db/catalog-index'
import { deleteTenantDbForTests, openTenantDb } from '../../db/solva-db'
import { applyPullCycle } from '../../sync/applier'
import { resolveScan, resolveSearch, type ScanLookupDeps } from './resolve-scan'

const TENANT = '0192a000-0000-7000-8000-00000000b365'
const OUTLET_A = '0192a000-0000-7000-8000-00000000c021'
const OUTLET_B = '0192a000-0000-7000-8000-00000000c022'
const OUTLET_C = '0192a000-0000-7000-8000-00000000c023'

afterEach(async () => {
  clearCatalogIndexCache(TENANT)
  await deleteTenantDbForTests(TENANT)
})

describe('pos/usecases/catalog/resolve-scan', () => {
  it('handles every scan decision branch deterministically with pure lookup deps', async () => {
    const baseMatch = {
      skuUom: { id: 'su1', sku_id: 's1', uom_id: 'u1', conversion_factor: '1', is_base: true, barcode: '111' },
      sku: { id: 's1', product_id: 'p1', sku_code: 'P1', variant_label: null, is_default: true, is_active: true, sort_order: 1 },
      product: {
        id: 'p1',
        category_id: 'c1',
        code: 'P1',
        name: 'Kopi Bubuk 200g',
        product_type: 'RETAIL',
        has_variants: false,
        base_uom_id: 'u1',
        track_stock: true,
        taxable: true,
        is_active: true,
        is_open_price: false,
        sort_order: 1,
        search_tokens: ['kopi'],
      },
    }

    const cases: Array<{
      name: string
      deps: ScanLookupDeps
      expectedKind: string
    }> = [
      {
        name: 'unknown barcode',
        deps: {
          findByBarcode: async () => null,
          getAvailabilityRows: async () => [],
          getPrice: async () => ({ kind: 'NO_PRICE' }),
        },
        expectedKind: 'UNKNOWN_BARCODE',
      },
      {
        name: 'global product inactive beats availability (BR-CAT-004)',
        deps: {
          findByBarcode: async () => ({
            ...baseMatch,
            product: { ...baseMatch.product, is_active: false },
          }),
          getAvailabilityRows: async () => [
            { id: 'av1', outlet_id: OUTLET_C, product_id: 'p1', sku_id: null, sku_key: '*', status: 'AVAILABLE' },
          ],
          getPrice: async () => ({ kind: 'PRICE', price: toMoney(10000), source: 'DEFAULT' }),
        },
        expectedKind: 'UNAVAILABLE_AT_OUTLET',
      },
      {
        name: 'outlet unavailable distinct from unknown barcode (BR-CAT-015)',
        deps: {
          findByBarcode: async () => baseMatch,
          getAvailabilityRows: async () => [
            { id: 'av1', outlet_id: OUTLET_C, product_id: 'p1', sku_id: null, sku_key: '*', status: 'UNAVAILABLE' },
          ],
          getPrice: async () => ({ kind: 'PRICE', price: toMoney(10000), source: 'DEFAULT' }),
        },
        expectedKind: 'UNAVAILABLE_AT_OUTLET',
      },
      {
        name: 'missing price blocks add to cart (BR-PRC-002)',
        deps: {
          findByBarcode: async () => baseMatch,
          getAvailabilityRows: async () => [],
          getPrice: async () => ({ kind: 'NO_PRICE' }),
        },
        expectedKind: 'NO_PRICE',
      },
      {
        name: 'open price succeeds without master price',
        deps: {
          findByBarcode: async () => ({
            ...baseMatch,
            product: { ...baseMatch.product, is_open_price: true },
          }),
          getAvailabilityRows: async () => [],
          getPrice: async () => ({ kind: 'OPEN_PRICE', suggested: null }),
        },
        expectedKind: 'FOUND',
      },
    ]

    for (const tc of cases) {
      const res = await resolveScan('111', OUTLET_C, tc.deps)
      expect(res.kind, tc.name).toBe(tc.expectedKind)
      if (tc.expectedKind === 'UNAVAILABLE_AT_OUTLET') {
        expect((res as { productName: string }).productName).toBe('Kopi Bubuk 200g')
      }
    }
  })

  it('reproduces section 7.2.4 Example 1 & V-27 against Dexie fake-indexeddb', async () => {
    const db = await openTenantDb(TENANT)
    await stagePullRows(db, [
      {
        cycle_id: 'c1',
        entity: 'product',
        op: 'upsert',
        id: 'p-kaos',
        version: 1,
        payload: {
          category_id: 'cat1',
          code: 'KAOS',
          name: 'Kaos Polos',
          product_type: 'RETAIL',
          has_variants: true,
          base_uom_id: 'u-pcs',
          track_stock: true,
          taxable: true,
          is_active: true,
          is_open_price: false,
          sort_order: 1,
        },
      },
      ...['S-HTM', 'M-HTM', 'L-HTM', 'S-PTH', 'M-PTH', 'L-PTH'].map((code, i) => ({
        cycle_id: 'c1',
        entity: 'sku',
        op: 'upsert' as const,
        id: `sku-${code}`,
        version: 1,
        payload: {
          product_id: 'p-kaos',
          sku_code: `KAOS-${code}`,
          variant_label: code,
          is_default: i === 0,
          is_active: true,
          sort_order: i,
        },
      })),
      {
        cycle_id: 'c1',
        entity: 'sku_uom',
        op: 'upsert',
        id: 'su-s-htm',
        version: 1,
        payload: {
          sku_id: 'sku-S-HTM',
          uom_id: 'u-pcs',
          conversion_factor: '1',
          is_base: true,
          barcode: '8999999000100',
        },
      },
      {
        cycle_id: 'c1',
        entity: 'price_entry',
        op: 'upsert',
        id: 'pe-s-htm',
        version: 1,
        payload: { sku_id: 'sku-S-HTM', uom_id: 'u-pcs', outlet_id: null, price: 75000, currency: 'IDR' },
      },
      // Outlet B has 3 PTH SKUs unavailable -> V-27 = 6/3/6
      ...['S-PTH', 'M-PTH', 'L-PTH'].map((code) => ({
        cycle_id: 'c1',
        entity: 'item_outlet_availability',
        op: 'upsert' as const,
        id: `av-b-${code}`,
        version: 1,
        payload: {
          outlet_id: OUTLET_B,
          product_id: 'p-kaos',
          sku_id: `sku-${code}`,
          status: 'UNAVAILABLE',
        },
      })),
    ])

    await applyPullCycle(db, {
      cycleId: 'c1',
      finalCursor: { version: 20, id: 'av-b-L-PTH' },
      catalogCursor: 20,
      immediate: true,
    })

    const scanDeps = createCatalogScanDeps(db)
    const foundAtA = await resolveScan('8999999000100', OUTLET_A, scanDeps)
    expect(foundAtA.kind).toBe('FOUND')

    // Hide all S-HTM at Outlet C and confirm scan reports UNAVAILABLE_AT_OUTLET
    await stagePullRows(db, [
      {
        cycle_id: 'c2',
        entity: 'item_outlet_availability',
        op: 'upsert',
        id: 'av-c-kaos',
        version: 21,
        payload: { outlet_id: OUTLET_C, product_id: 'p-kaos', sku_id: null, status: 'UNAVAILABLE' },
      },
    ])
    await applyPullCycle(db, {
      cycleId: 'c2',
      finalCursor: { version: 21, id: 'av-c-kaos' },
      catalogCursor: 21,
      immediate: true,
    })

    const blockedAtC = await resolveScan('8999999000100', OUTLET_C, scanDeps)
    expect(blockedAtC).toEqual({
      kind: 'UNAVAILABLE_AT_OUTLET',
      productName: 'Kaos Polos',
    })

    const searchRes = await resolveSearch(
      'kaos',
      { outletId: OUTLET_A },
      {
        searchProducts: (q, opts) => searchProducts(db, q, opts),
        getPrice: scanDeps.getPrice,
      },
    )
    expect(searchRes).toHaveLength(1)
    expect(searchRes[0]?.price).toEqual({ kind: 'PRICE', price: 75000, source: 'DEFAULT' })
  })
})
