import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { clearCatalogIndexCache } from '../db/catalog-index'
import { tenantDbName } from '../locks/names'
import { closeTenantDb, openTenantDb } from '../db/solva-db'
import { applyPullCycle } from '../sync/applier'
import { stagePullRows } from '../data/pull-stage.repo'
import {
  findByBarcode,
  getAvailabilityRows,
  getPrice,
  listVisibleProducts,
  searchProducts,
} from './catalog.repo'

const TENANT = '0192a000-0000-7000-8000-00000000b363'
const OUTLET_A = '0192a000-0000-7000-8000-00000000c011'

afterEach(async () => {
  clearCatalogIndexCache(TENANT)
  closeTenantDb(TENANT)
  await Dexie.delete(tenantDbName(TENANT))
})

describe('pos/data/catalog.repo', () => {
  it('supports indexed barcode lookup, search exclusion for UNAVAILABLE, price resolution, and UOM separation', async () => {
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
        outlet_id: OUTLET_A,
        register_type: 'CASHIER',
      },
    })

    await stagePullRows(db, [
      {
        cycle_id: 'c1',
        entity: 'product',
        op: 'upsert',
        id: 'p-susu',
        version: 1,
        payload: {
          category_id: 'cat1',
          code: 'SUSU-UHT',
          name: 'Susu UHT 1L',
          product_type: 'RETAIL',
          has_variants: false,
          base_uom_id: 'u-pcs',
          track_stock: true,
          taxable: true,
          is_active: true,
          is_open_price: false,
          sort_order: 2,
        },
      },
      {
        cycle_id: 'c1',
        entity: 'product',
        op: 'upsert',
        id: 'p-kopi',
        version: 1,
        payload: {
          category_id: 'cat1',
          code: 'KP-200',
          name: 'Kopi Bubuk 200g',
          product_type: 'RETAIL',
          has_variants: false,
          base_uom_id: 'u-pcs',
          track_stock: true,
          taxable: true,
          is_active: true,
          is_open_price: false,
          sort_order: 1,
        },
      },
      {
        cycle_id: 'c1',
        entity: 'sku',
        op: 'upsert',
        id: 's-susu',
        version: 1,
        payload: {
          product_id: 'p-susu',
          sku_code: 'SUSU-UHT',
          variant_label: null,
          is_default: true,
          is_active: true,
          sort_order: 1,
        },
      },
      {
        cycle_id: 'c1',
        entity: 'sku',
        op: 'upsert',
        id: 's-kopi',
        version: 1,
        payload: {
          product_id: 'p-kopi',
          sku_code: 'KP-200',
          variant_label: null,
          is_default: true,
          is_active: true,
          sort_order: 1,
        },
      },
      {
        cycle_id: 'c1',
        entity: 'sku_uom',
        op: 'upsert',
        id: 'su-susu-pcs',
        version: 1,
        payload: {
          sku_id: 's-susu',
          uom_id: 'u-pcs',
          conversion_factor: '1',
          is_base: true,
          barcode: '8991001',
        },
      },
      {
        cycle_id: 'c1',
        entity: 'sku_uom',
        op: 'upsert',
        id: 'su-susu-dus',
        version: 1,
        payload: {
          sku_id: 's-susu',
          uom_id: 'u-dus',
          conversion_factor: '12',
          is_base: false,
          barcode: '8991012',
        },
      },
      {
        cycle_id: 'c1',
        entity: 'price_entry',
        op: 'upsert',
        id: 'pe-susu-pcs-def',
        version: 1,
        payload: { sku_id: 's-susu', uom_id: 'u-pcs', outlet_id: null, price: 11500, currency: 'IDR' },
      },
      {
        cycle_id: 'c1',
        entity: 'price_entry',
        op: 'upsert',
        id: 'pe-susu-pcs-out',
        version: 1,
        payload: { sku_id: 's-susu', uom_id: 'u-pcs', outlet_id: OUTLET_A, price: 12000, currency: 'IDR' },
      },
      {
        cycle_id: 'c1',
        entity: 'price_entry',
        op: 'upsert',
        id: 'pe-susu-dus-def',
        version: 1,
        payload: { sku_id: 's-susu', uom_id: 'u-dus', outlet_id: null, price: 130000, currency: 'IDR' },
      },
      {
        cycle_id: 'c1',
        entity: 'item_outlet_availability',
        op: 'upsert',
        id: 'av-kopi',
        version: 1,
        payload: { outlet_id: OUTLET_A, product_id: 'p-kopi', sku_id: null, status: 'UNAVAILABLE' },
      },
    ])

    await applyPullCycle(db, {
      cycleId: 'c1',
      finalCursor: { version: 10, id: 'av-kopi' },
      catalogCursor: 10,
      immediate: true,
    })

    const barcodeHit = await findByBarcode(db, ' 8991001 ')
    expect(barcodeHit?.product.id).toBe('p-susu')
    expect(barcodeHit?.skuUom.uom_id).toBe('u-pcs')
    expect(await findByBarcode(db, 'unknown')).toBeNull()

    // Outlet price wins over tenant default for pcs; dus uses default without 12 * pcs multiplication.
    expect(await getPrice(db, 's-susu', 'u-pcs', OUTLET_A)).toEqual({
      kind: 'PRICE',
      price: 12000,
      source: 'OUTLET',
    })
    expect(await getPrice(db, 's-susu', 'u-dus', OUTLET_A)).toEqual({
      kind: 'PRICE',
      price: 130000,
      source: 'DEFAULT',
    })

    // Search filters out UNAVAILABLE Kopi while matching Susu via prefix token intersection.
    expect(await searchProducts(db, 'kopi', { outletId: OUTLET_A })).toEqual([])
    const hits = await searchProducts(db, 'su uht', { outletId: OUTLET_A })
    expect(hits.map((h) => h.product.id)).toEqual(['p-susu'])

    // Exact & prefix code match returns Susu cleanly.
    const exactCode = await searchProducts(db, 'SUSU-UHT', { outletId: OUTLET_A })
    expect(exactCode).toHaveLength(1)
    const prefixCode = await searchProducts(db, 'SUSU-U', { outletId: OUTLET_A })
    expect(prefixCode.map((h) => h.product.id)).toEqual(['p-susu'])

    const listed = await listVisibleProducts(db, { outletId: OUTLET_A })
    expect(listed.total).toBe(1)
    expect(listed.items[0]?.product.code).toBe('SUSU-UHT')

    const availRows = await getAvailabilityRows(db, 'p-kopi')
    expect(availRows).toHaveLength(1)
    expect(availRows[0]?.status).toBe('UNAVAILABLE')
  })
})
