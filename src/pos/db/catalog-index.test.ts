import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { stagePullRows } from '../data/pull-stage.repo'
import { tenantDbName } from '../locks/names'
import { applyPullCycle } from '../sync/applier'
import {
  buildCatalogAvailabilityIndex,
  clearCatalogIndexCache,
  computeAvailabilityMap,
  getCatalogAvailabilityIndex,
  subscribeCatalogIndex,
} from './catalog-index'
import { closeTenantDb, openTenantDb } from './solva-db'

const TENANT = '0192a000-0000-7000-8000-00000000b362'
const OUTLET = '0192a000-0000-7000-8000-00000000c001'

afterEach(async () => {
  clearCatalogIndexCache(TENANT)
  closeTenantDb(TENANT)
  await Dexie.delete(tenantDbName(TENANT))
})

describe('pos/db/catalog-index', () => {
  it('rebuilds index on applier commit and matches effectiveAvailability precedence', async () => {
    const db = await openTenantDb(TENANT)
    await db.meta.put({
      key: 'device',
      value: {
        device_id: 'd1',
        credential: 'cred',
        credential_expires_at: '2027-01-01T00:00:00Z',
        tenant_id: TENANT,
        slug: 'acme',
        register_id: 'r1',
        outlet_id: OUTLET,
        register_type: 'CASHIER',
      },
    })

    const events: number[] = []
    const unsub = subscribeCatalogIndex((e) => events.push(e.cursor))

    try {
      await stagePullRows(db, [
        {
          cycle_id: 'c1',
          entity: 'product',
          op: 'upsert',
          id: 'p-avail',
          version: 1,
          payload: {
            category_id: 'cat1',
            code: 'KP-1',
            name: 'Kopi',
            product_type: 'MENU_FNB',
            has_variants: true,
            base_uom_id: 'u1',
            track_stock: false,
            taxable: true,
            is_active: true,
            is_open_price: false,
            sort_order: 1,
          },
        },
        {
          cycle_id: 'c1',
          entity: 'product',
          op: 'upsert',
          id: 'p-inactive',
          version: 1,
          payload: {
            category_id: 'cat1',
            code: 'OFF-1',
            name: 'Discontinued',
            product_type: 'RETAIL',
            has_variants: false,
            base_uom_id: 'u1',
            track_stock: false,
            taxable: true,
            is_active: false,
            is_open_price: false,
            sort_order: 2,
          },
        },
        {
          cycle_id: 'c1',
          entity: 'sku',
          op: 'upsert',
          id: 's-1',
          version: 1,
          payload: {
            product_id: 'p-avail',
            sku_code: 'KP-1-A',
            variant_label: 'Hot',
            is_default: true,
            is_active: true,
            sort_order: 1,
          },
        },
        {
          cycle_id: 'c1',
          entity: 'sku',
          op: 'upsert',
          id: 's-2',
          version: 1,
          payload: {
            product_id: 'p-avail',
            sku_code: 'KP-1-B',
            variant_label: 'Ice',
            is_default: false,
            is_active: true,
            sort_order: 2,
          },
        },
        {
          cycle_id: 'c1',
          entity: 'sku',
          op: 'upsert',
          id: 's-inactive',
          version: 1,
          payload: {
            product_id: 'p-inactive',
            sku_code: 'OFF-1',
            variant_label: null,
            is_default: true,
            is_active: true,
            sort_order: 1,
          },
        },
        {
          cycle_id: 'c1',
          entity: 'item_outlet_availability',
          op: 'upsert',
          id: 'av-prod',
          version: 1,
          payload: {
            outlet_id: OUTLET,
            product_id: 'p-avail',
            sku_id: null,
            status: 'UNAVAILABLE',
          },
        },
        {
          cycle_id: 'c1',
          entity: 'item_outlet_availability',
          op: 'upsert',
          id: 'av-sku-override',
          version: 1,
          payload: {
            outlet_id: OUTLET,
            product_id: 'p-avail',
            sku_id: 's-2',
            status: 'AVAILABLE',
          },
        },
      ])

      await applyPullCycle(db, {
        cycleId: 'c1',
        finalCursor: { version: 5, id: 'av-sku-override' },
        catalogCursor: 5,
        immediate: true,
      })

      expect(events).toEqual([5])
      const idx = await getCatalogAvailabilityIndex(db, OUTLET)
      expect(idx.get('s-1')).toBe(false)
      expect(idx.get('s-2')).toBe(true)
      expect(idx.get('s-inactive')).toBe(false)
    } finally {
      unsub()
    }
  })

  it('builds 5,000 SKUs availability index well within 100ms', async () => {
    const db = await openTenantDb(TENANT)
    const products = Array.from({ length: 1250 }, (_, i) => ({
      id: `p-${i}`,
      category_id: 'c1',
      code: `P-${i}`,
      name: `Product ${i}`,
      product_type: 'RETAIL',
      has_variants: true,
      base_uom_id: 'u1',
      track_stock: true,
      taxable: true,
      is_active: true,
      is_open_price: false,
      sort_order: i,
      search_tokens: ['product', String(i)],
    }))
    const skus = products.flatMap((p, pi) =>
      [1, 2, 3, 4].map((v) => ({
        id: `s-${pi}-${v}`,
        product_id: p.id,
        sku_code: `${p.code}-V${v}`,
        variant_label: `V${v}`,
        is_default: v === 1,
        is_active: true,
        sort_order: v,
      })),
    )
    const avail = products.map((p, pi) => ({
      id: `av-${pi}`,
      outlet_id: OUTLET,
      product_id: p.id,
      sku_id: null,
      sku_key: '*',
      status: pi % 5 === 0 ? ('UNAVAILABLE' as const) : ('AVAILABLE' as const),
    }))

    const tCompute0 = performance.now()
    const computedMap = computeAvailabilityMap(OUTLET, products, skus, avail)
    const computeMs = performance.now() - tCompute0
    expect(computedMap.size).toBe(5000)
    expect(computeMs).toBeLessThan(100)

    await db.product.bulkPut(products)
    await db.sku.bulkPut(skus)
    await db.item_outlet_availability.bulkPut(avail)

    const t0 = performance.now()
    const map = await buildCatalogAvailabilityIndex(db, OUTLET)
    const elapsedMs = performance.now() - t0
    expect(map.size).toBe(5000)
    // Allow fake-indexeddb deserialization slack when Vitest spawns 125 parallel workers.
    expect(elapsedMs).toBeLessThan(1500)
  })
})
