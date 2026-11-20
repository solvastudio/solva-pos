import { afterEach, describe, expect, it } from 'vitest'
import { calcSale } from '~/lib/sales-calc'
import { roundToUnit } from '~/lib/kernel'
import { createCatalogScanDeps } from '../data/catalog.repo'
import { setMeta } from '../data/meta.repo'
import { listSendable } from '../data/outbox.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { buildConfigSnapshot } from '../domain/config-snapshot'
import { toCalcInput } from '../domain/cart'
import { createCartStore } from '../state/cart-store'
import { resolveScan } from '../usecases/catalog/resolve-scan'
import { openShift } from '../usecases/shift/open-shift'

const T1 = '0192a000-0000-7000-8000-00000000b901'
const OUT = '0192a000-0000-7000-8000-00000000b902'
const REG = '0192a000-0000-7000-8000-00000000b903'
const DEV = '0192a000-0000-7000-8000-00000000b904'
const STAFF = '0192a000-0000-7000-8000-00000000b905'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos sell flow integration (openShift -> barcode scan -> V-04 cart -> draft restore)', () => {
  it('executes full offline open shift + barcode scans + line discount + draft reload without network', async () => {
    const db = await openTenantDb(T1)

    await setMeta(db, 'device', {
      device_id: DEV,
      credential: 'cred-1',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'demo',
      register_id: REG,
      outlet_id: OUT,
      register_type: 'CASHIER',
    })
    await setMeta(db, 'clock', {
      offset_ms: 0,
      offset_at: '2026-11-20T00:00:00.000Z',
      max_seen_time: '2026-11-20T00:00:00.000Z',
    })
    await db.outlet.put({
      id: OUT,
      legal_entity_id: '0192a000-0000-7000-8000-00000000b999',
      code: 'OUT1',
      name: 'Outlet Demo',
      timezone: 'Asia/Jakarta',
      day_cutoff_time: '04:00',
      price_tax_mode: 'EXCLUSIVE',
      tax_profile: 'PPN',
      cash_rounding_unit: 100,
      service_charge_enabled: false,
      service_charge_rate: '0',
      service_charge_taxable: true,
      deleted_at: null,
    })
    await db.tax_rate_history.put({
      id: 'tr-1',
      tax_code: 'PPN',
      outlet_id: null,
      outlet_key: '*',
      effective_from: '2025-01-01',
      rate: '11.0000',
      deleted_at: null,
    })
    await db.uom.put({
      id: 'uom-pcs',
      code: 'pcs',
      name: 'Pieces',
      allow_fraction: false,
      deleted_at: null,
    })

    // Seed Kopi, Gula, Susu per V-04
    const seeds = [
      { id: 'p1', skuId: 's1', code: 'KOP', name: 'Kopi', barcode: '8991001', price: 18500 },
      { id: 'p2', skuId: 's2', code: 'GUL', name: 'Gula 1kg', barcode: '8991002', price: 16000 },
      { id: 'p3', skuId: 's3', code: 'SUS', name: 'Susu UHT 1L', barcode: '8991003', price: 17900 },
    ]
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i]!
      await db.product.put({
        id: s.id,
        category_id: 'cat-1',
        code: s.code,
        name: s.name,
        product_type: 'RETAIL',
        has_variants: false,
        base_uom_id: 'uom-pcs',
        track_stock: false,
        taxable: true,
        is_active: true,
        is_open_price: false,
        sort_order: i + 1,
        search_tokens: [s.name.toLowerCase()],
        deleted_at: null,
      })
      await db.sku.put({
        id: s.skuId,
        product_id: s.id,
        sku_code: s.code,
        variant_label: null,
        is_default: true,
        is_active: true,
        sort_order: 1,
        deleted_at: null,
      })
      await db.sku_uom.put({
        id: `su-${s.id}`,
        sku_id: s.skuId,
        uom_id: 'uom-pcs',
        conversion_factor: '1',
        is_base: true,
        barcode: s.barcode,
        deleted_at: null,
      })
      await db.price_entry.put({
        id: `pe-${s.id}`,
        sku_id: s.skuId,
        uom_id: 'uom-pcs',
        outlet_id: null,
        outlet_key: '*',
        currency: 'IDR',
        price: s.price,
        deleted_at: null,
      })
      await db.item_outlet_availability.put({
        id: `av-${s.id}`,
        product_id: s.id,
        sku_id: null,
        sku_key: '*',
        outlet_id: OUT,
        status: 'AVAILABLE',
        deleted_at: null,
      })
    }

    const shiftRes = await openShift(db, { openingCash: 200_000, staffId: STAFF })
    expect(shiftRes.ok).toBe(true)
    if (!shiftRes.ok) return

    const outbox = await listSendable(db, { nowIso: new Date(Date.now() + 10_000).toISOString() })
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.type).toBe('OpenShift')

    const cfg = await buildConfigSnapshot(db, {
      outletId: OUT,
      businessDate: shiftRes.shift.business_date,
    })
    expect(cfg.ok).toBe(true)
    if (!cfg.ok) return

    const store = createCartStore()
    const ctx = {
      registerId: REG,
      staffId: STAFF,
      shiftId: shiftRes.shift.id,
      config: cfg.config,
      cashRoundingUnit: cfg.cashRoundingUnit,
      taxRateId: cfg.taxRateId,
    }
    await store.getState().hydrate(db, ctx)

    const scanDeps = createCatalogScanDeps(db)
    const scans = ['8991001', '8991001', '8991002', '8991003', '8991003', '8991003']
    let susuLineId = ''
    for (const code of scans) {
      const scan = await resolveScan(code, OUT, scanDeps)
      expect(scan.kind).toBe('FOUND')
      if (scan.kind !== 'FOUND') return
      const addRes = store.getState().addItem({
        skuId: scan.skuId,
        productId: scan.productId,
        uomId: scan.uomId,
        skuCode: code,
        itemName: scan.name,
        variantLabel: scan.variantLabel ?? undefined,
        uomCode: 'pcs',
        conversionFactor: scan.conversionFactor,
        taxable: true,
        allowFraction: false,
        price: scan.price,
      })
      expect(addRes.ok).toBe(true)
      if (code === '8991003' && addRes.ok) {
        susuLineId = addRes.touchedLineId!
      }
    }

    store.getState().setLineDiscount(susuLineId, { type: 'PERCENT', pct: '10' })
    await store.getState().flushDraft()

    // Reload store from Dexie
    const reloaded = createCartStore()
    await reloaded.getState().hydrate(db, ctx)
    const totals = calcSale(toCalcInput(reloaded.getState().cart))
    expect(totals.grandTotal).toBe(112_476)
    expect(roundToUnit(totals.grandTotal, ctx.cashRoundingUnit)).toBe(112_500)
  })
})
