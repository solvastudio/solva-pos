import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { tenantDbName } from '../locks/names'
import { closeTenantDb, openTenantDb } from '../db/solva-db'
import { deriveLocalFields } from './derive-local-fields'
import { applyMasterRows } from './master.repo'

const TENANT = '0192a000-0000-7000-8000-00000000b361'

afterEach(async () => {
  closeTenantDb(TENANT)
  await Dexie.delete(tenantDbName(TENANT))
})

describe('pos/data/derive-local-fields', () => {
  it('derives local Dexie fields cleanly per entity table specification', () => {
    const prod = deriveLocalFields('product', {
      id: 'p1',
      name: 'Kopi Süsü Aren',
      code: 'KP-100',
    })
    expect(prod.search_tokens).toEqual(['kopi', 'susu', 'aren', 'kp-100'])

    const defPrice = deriveLocalFields('price_entry', {
      id: 'pr1',
      outlet_id: null,
      price: 15000,
    })
    expect(defPrice.outlet_key).toBe('*')
    expect(typeof defPrice.price).toBe('number')
    expect(defPrice.price).toBe(15000)

    const outPrice = deriveLocalFields('price_entry', {
      id: 'pr2',
      outlet_id: 'o1',
      price: '16500',
    })
    expect(outPrice.outlet_key).toBe('o1')
    expect(outPrice.price).toBe(16500)

    const prodAvail = deriveLocalFields('item_outlet_availability', {
      id: 'a1',
      product_id: 'p1',
      sku_id: null,
    })
    expect(prodAvail.sku_key).toBe('*')

    const skuAvail = deriveLocalFields('item_outlet_availability', {
      id: 'a2',
      product_id: 'p1',
      sku_id: 's1',
    })
    expect(skuAvail.sku_key).toBe('s1')

    const taxGlobal = deriveLocalFields('tax_rate_history', {
      id: 't1',
      outlet_id: null,
    })
    expect(taxGlobal.outlet_key).toBe('*')

    const taxOutlet = deriveLocalFields('tax_rate_history', {
      id: 't2',
      outlet_id: 'o1',
    })
    expect(taxOutlet.outlet_key).toBe('o1')

    const prefix = deriveLocalFields('register_invoice_prefix', {
      id: 'r1',
      invoice_prefix: 'INV01',
    })
    expect(prefix).toEqual({ id: 'r1', invoice_prefix: 'INV01' })

    const receipt = deriveLocalFields('outlet_receipt_setting', {
      id: 'rs1',
      footer_text: 'Thanks',
    })
    expect(receipt).toEqual({ id: 'rs1', footer_text: 'Thanks' })

    const skuUomEmpty = deriveLocalFields('sku_uom', {
      id: 'su1',
      conversion_factor: '1.0000',
      barcode: null,
    })
    expect(Object.hasOwn(skuUomEmpty, 'barcode')).toBe(false)
    expect(skuUomEmpty.conversion_factor).toBe('1.0000')

    const skuUomBlank = deriveLocalFields('sku_uom', {
      id: 'su2',
      conversion_factor: 12,
      barcode: '   ',
    })
    expect(Object.hasOwn(skuUomBlank, 'barcode')).toBe(false)
    expect(skuUomBlank.conversion_factor).toBe('12')

    const skuUomVal = deriveLocalFields('sku_uom', {
      id: 'su3',
      conversion_factor: '12.0000',
      barcode: ' 899123 ',
    })
    expect(skuUomVal.barcode).toBe('899123')
  })

  it('allows storing multiple sku_uom rows without barcodes under unique &barcode index', async () => {
    const db = await openTenantDb(TENANT)
    await db.transaction('rw', db.sku_uom, async (tx) => {
      await applyMasterRows(tx, [
        {
          entity: 'sku_uom',
          op: 'upsert',
          id: 'su-1',
          payload: { sku_id: 's1', uom_id: 'u1', conversion_factor: '1', is_base: true, barcode: null },
        },
        {
          entity: 'sku_uom',
          op: 'upsert',
          id: 'su-2',
          payload: { sku_id: 's2', uom_id: 'u1', conversion_factor: '1', is_base: true, barcode: '' },
        },
      ])
    })
    expect(await db.sku_uom.count()).toBe(2)
  })
})
