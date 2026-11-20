import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { FEATURE_FLAGS } from '~/lib/feature-flags'
import { closePools } from '~/server/db'
import { masterTx } from './helpers/master'
import { createTestTenant, uniqueSlug, withTestTenant } from './helpers/tenants'

async function seedOutlet(tenantId: string) {
  return masterTx(tenantId, async (client, version) => {
    const leId = (
      await client.query<{ id: string }>(
        `INSERT INTO legal_entity (tenant_id, version, name) VALUES ($1, $2, 'PT Catalog') RETURNING id`,
        [tenantId, version],
      )
    ).rows[0]!.id
    const outletId = (
      await client.query<{ id: string }>(
        `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode)
         VALUES ($1, $2, $3, 'OUT01', 'Outlet 1', 'INCLUSIVE') RETURNING id`,
        [tenantId, version, leId],
      )
    ).rows[0]!.id
    return { leId, outletId }
  })
}

async function seedBaseCatalog(tenantId: string, opts?: { hasVariants?: boolean }) {
  return masterTx(tenantId, async (client, version) => {
    const catId = (
      await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Beverages') RETURNING id`,
        [tenantId, version],
      )
    ).rows[0]!.id
    const pcsId = (
      await client.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pieces') RETURNING id`,
        [tenantId, version],
      )
    ).rows[0]!.id
    const dusId = (
      await client.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'dus', 'Carton') RETURNING id`,
        [tenantId, version],
      )
    ).rows[0]!.id
    const prodId = (
      await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id, has_variants)
         VALUES ($1, $2, $3, 'KOPI01', 'Kopi Susu', $4, $5) RETURNING id`,
        [tenantId, version, catId, pcsId, opts?.hasVariants ?? false],
      )
    ).rows[0]!.id
    return { catId, pcsId, dusId, prodId }
  })
}

describe('catalog and feature_flag schema constraints and triggers (Phase 31)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('keeps FEATURE_FLAGS empty and enforces category depth <= 2 & case-insensitive unique names', async () => {
    expect(FEATURE_FLAGS).toEqual({})
    const t = await createTestTenant(uniqueSlug('cat-hier'))

    const { rootId, subId } = await masterTx(t.id, async (client, version) => {
      const r = (
        await client.query<{ id: string }>(
          `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Drinks') RETURNING id`,
          [t.id, version],
        )
      ).rows[0]!.id
      const s = (
        await client.query<{ id: string }>(
          `INSERT INTO category (tenant_id, version, parent_id, name) VALUES ($1, $2, $3, 'Coffee') RETURNING id`,
          [t.id, version, r],
        )
      ).rows[0]!.id
      return { rootId: r, subId: s }
    })

    // 3rd level rejected
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO category (tenant_id, version, parent_id, name) VALUES ($1, $2, $3, 'Espresso')`,
          [t.id, version, subId],
        )
      }),
    ).rejects.toThrow(/category depth > 2/)

    // Reparenting root-with-children under another root rejected
    const otherRoot = await masterTx(t.id, async (client, version) => {
      return (
        await client.query<{ id: string }>(
          `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Food') RETURNING id`,
          [t.id, version],
        )
      ).rows[0]!.id
    })
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `UPDATE category SET parent_id = $3, version = $2 WHERE id = $1`,
          [rootId, version, otherRoot],
        )
      }),
    ).rejects.toThrow(/category depth > 2/)

    // Case-insensitive duplicate under NULL parent (NULLS NOT DISTINCT) rejected
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'drinks')`,
          [t.id, version],
        )
      }),
    ).rejects.toMatchObject({ code: '23505' })

    // Same name under DIFFERENT parent is allowed
    const subSameName = await masterTx(t.id, async (client, version) => {
      return (
        await client.query<{ id: string }>(
          `INSERT INTO category (tenant_id, version, parent_id, name) VALUES ($1, $2, $3, 'coffee') RETURNING id`,
          [t.id, version, otherRoot],
        )
      ).rows[0]!.id
    })
    expect(subSameName).toBeTruthy()
  })

  it('enforces uom.code format & uniqueness, and product.code tombstone uniqueness', async () => {
    const t = await createTestTenant(uniqueSlug('uom-prod'))

    // Invalid UOM code (uppercase / >12 chars) rejected
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'PCS', 'Pieces')`,
          [t.id, version],
        )
      }),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'abcdefghijklm', 'Too Long')`,
          [t.id, version],
        )
      }),
    ).rejects.toMatchObject({ code: '23514' })

    const base = await seedBaseCatalog(t.id)

    // Duplicate UOM code rejected
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Duplicate')`,
          [t.id, version],
        )
      }),
    ).rejects.toMatchObject({ code: '23505' })

    // Duplicate active product.code rejected
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id)
           VALUES ($1, $2, $3, 'KOPI01', 'Duplicate Code', $4)`,
          [t.id, version, base.catId, base.pcsId],
        )
      }),
    ).rejects.toMatchObject({ code: '23505' })

    // Allowed after tombstoning original product
    await masterTx(t.id, async (client, version) => {
      await client.query(
        `UPDATE product SET deleted_at = now(), version = $2 WHERE id = $1`,
        [base.prodId, version],
      )
      await client.query(
        `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id)
         VALUES ($1, $2, $3, 'KOPI01', 'Reused Code', $4)`,
        [t.id, version, base.catId, base.pcsId],
      )
    })
  })

  it('enforces max 3 attributes, max 100 active SKUs, and one attribute_value per attribute per SKU', async () => {
    const t = await createTestTenant(uniqueSlug('var-limits'))
    const base = await seedBaseCatalog(t.id, { hasVariants: true })

    // Insert 3 attributes -> OK; 4th rejected
    const attrIds: string[] = []
    for (let i = 1; i <= 3; i += 1) {
      const aId = await masterTx(t.id, async (client, version) => {
        const res = await client.query<{ id: string }>(
          `INSERT INTO product_attribute (tenant_id, product_id, name, sort_order)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [t.id, base.prodId, `Attr${i}`, i],
        )
        void version
        return res.rows[0]!.id
      })
      attrIds.push(aId)
    }
    await expect(
      masterTx(t.id, async (client) => {
        await client.query(
          `INSERT INTO product_attribute (tenant_id, product_id, name) VALUES ($1, $2, 'Attr4')`,
          [t.id, base.prodId],
        )
      }),
    ).rejects.toThrow(/more than 3 active attributes/)

    // Single attribute per SKU rule
    const { v1Id, v2Id } = await masterTx(t.id, async (client) => {
      const v1 = (
        await client.query<{ id: string }>(
          `INSERT INTO attribute_value (tenant_id, attribute_id, value) VALUES ($1, $2, 'Small') RETURNING id`,
          [t.id, attrIds[0]!],
        )
      ).rows[0]!.id
      const v2 = (
        await client.query<{ id: string }>(
          `INSERT INTO attribute_value (tenant_id, attribute_id, value) VALUES ($1, $2, 'Large') RETURNING id`,
          [t.id, attrIds[0]!],
        )
      ).rows[0]!.id
      return { v1Id: v1, v2Id: v2 }
    })

    // Insert 100 active SKUs -> OK; 101st active SKU -> rejected; 1 inactive SKU -> allowed
    const firstSkuId = await masterTx(t.id, async (client, version) => {
      let firstId = ''
      for (let i = 1; i <= 100; i += 1) {
        const r = await client.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default, is_active, sort_order)
           VALUES ($1, $2, $3, $4, false, true, $5) RETURNING id`,
          [t.id, version, base.prodId, `SKU-${String(i).padStart(3, '0')}`, i],
        )
        if (i === 1) firstId = r.rows[0]!.id
      }
      return firstId
    })

    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default, is_active)
           VALUES ($1, $2, $3, 'SKU-101', false, true)`,
          [t.id, version, base.prodId],
        )
      }),
    ).rejects.toThrow(/more than 100 active SKUs/)

    // Assigning two values from the SAME attribute to one SKU is rejected
    await expect(
      masterTx(t.id, async (client) => {
        await client.query(
          `INSERT INTO sku_attribute_value (tenant_id, sku_id, attribute_value_id) VALUES ($1, $2, $3)`,
          [t.id, firstSkuId, v1Id],
        )
        await client.query(
          `INSERT INTO sku_attribute_value (tenant_id, sku_id, attribute_value_id) VALUES ($1, $2, $3)`,
          [t.id, firstSkuId, v2Id],
        )
      }),
    ).rejects.toThrow(/already has a value assigned for attribute/)
  })

  it('enforces deferred default-SKU invariants for single-variant vs multi-variant products', async () => {
    const t = await createTestTenant(uniqueSlug('sku-def'))
    const single = await seedBaseCatalog(t.id, { hasVariants: false })

    // Single-variant product with zero default SKUs fails on COMMIT
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, 'SINGLE-NONDEF', false)`,
          [t.id, version, single.prodId],
        )
      }),
    ).rejects.toThrow(/exactly 1 active default SKU/)

    // Single-variant product with two default SKUs fails
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, 'DEF-1', true)`,
          [t.id, version, single.prodId],
        )
        await client.query(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, 'DEF-2', true)`,
          [t.id, version, single.prodId],
        )
      }),
    ).rejects.toMatchObject({ code: '23505' })

    // Multi-variant product with default SKU fails
    const multiProdId = await masterTx(t.id, async (client, version) => {
      return (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id, has_variants)
           VALUES ($1, $2, $3, 'MULTI01', 'Multi Variant', $4, true) RETURNING id`,
          [t.id, version, single.catId, single.pcsId],
        )
      ).rows[0]!.id
    })
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, 'MULTI-DEF', true)`,
          [t.id, version, multiProdId],
        )
      }),
    ).rejects.toThrow(/must not have a default SKU/)
  })

  it('enforces sku_uom base/factor/barcode, price_entry, item_outlet_availability, and feature_flag rules', async () => {
    const t = await createTestTenant(uniqueSlug('uom-prc-avail'))
    const { outletId } = await seedOutlet(t.id)
    const base = await seedBaseCatalog(t.id, { hasVariants: false })

    const skuId = await masterTx(t.id, async (client, version) => {
      return (
        await client.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, 'KOPI01-DEF', true) RETURNING id`,
          [t.id, version, base.prodId],
        )
      ).rows[0]!.id
    })

    // is_base=true with factor != 1 rejected (BEFORE trigger / CHECK guard)
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base)
           VALUES ($1, $2, $3, $4, 12, true)`,
          [t.id, version, skuId, base.pcsId],
        )
      }),
    ).rejects.toThrow(/must use product base_uom_id with conversion_factor = 1/)

    // is_base=true with UOM != product.base_uom_id rejected
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base)
           VALUES ($1, $2, $3, $4, 1, true)`,
          [t.id, version, skuId, base.dusId],
        )
      }),
    ).rejects.toThrow(/must use product base_uom_id/)

    // non-base with UOM == product.base_uom_id rejected
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base)
           VALUES ($1, $2, $3, $4, 12, false)`,
          [t.id, version, skuId, base.pcsId],
        )
      }),
    ).rejects.toThrow(/non-base sku_uom cannot use product base_uom_id/)

    // Valid base + non-base with barcode
    const dusRowId = await masterTx(t.id, async (client, version) => {
      await client.query(
        `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base, barcode)
         VALUES ($1, $2, $3, $4, 1, true, '8990001')`,
        [t.id, version, skuId, base.pcsId],
      )
      return (
        await client.query<{ id: string }>(
          `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base, barcode)
           VALUES ($1, $2, $3, $4, 12, false, NULL) RETURNING id`,
          [t.id, version, skuId, base.dusId],
        )
      ).rows[0]!.id
    })

    // Second base row rejected; duplicate active barcode rejected
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base)
           VALUES ($1, $2, $3, $4, 1, true)`,
          [t.id, version, skuId, base.pcsId],
        )
      }),
    ).rejects.toMatchObject({ code: '23505' })

    const boxId = await masterTx(t.id, async (client, version) => {
      const box = (
        await client.query<{ id: string }>(
          `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'box', 'Box') RETURNING id`,
          [t.id, version],
        )
      ).rows[0]!.id
      // Multiple NULL barcodes accepted
      await client.query(
        `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base, barcode)
         VALUES ($1, $2, $3, $4, 6, false, NULL)`,
        [t.id, version, skuId, box],
      )
      return box
    })

    // Duplicate active barcode rejected
    const packId = await masterTx(t.id, async (client, version) => {
      return (
        await client.query<{ id: string }>(
          `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pack', 'Pack') RETURNING id`,
          [t.id, version],
        )
      ).rows[0]!.id
    })
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base, barcode)
           VALUES ($1, $2, $3, $4, 2, false, '8990001')`,
          [t.id, version, skuId, packId],
        )
      }),
    ).rejects.toMatchObject({ code: '23505' })

    // Barcode reused after tombstone is accepted
    await masterTx(t.id, async (client, version) => {
      await client.query(
        `UPDATE sku_uom SET deleted_at = now(), version = $2 WHERE id = $1`,
        [dusRowId, version],
      )
    })

    // Price checks: negative rejected, default NULLS NOT DISTINCT uniqueness, unconfigured sku_uom FK rejected
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO price_entry (tenant_id, version, sku_id, uom_id, outlet_id, price)
           VALUES ($1, $2, $3, $4, NULL, -1)`,
          [t.id, version, skuId, base.pcsId],
        )
      }),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO price_entry (tenant_id, version, sku_id, uom_id, outlet_id, price)
           VALUES ($1, $2, $3, $4, NULL, 10000)`,
          [t.id, version, skuId, packId],
        )
      }),
    ).rejects.toMatchObject({ code: '23503' })

    await masterTx(t.id, async (client, version) => {
      await client.query(
        `INSERT INTO price_entry (tenant_id, version, sku_id, uom_id, outlet_id, price)
         VALUES ($1, $2, $3, $4, NULL, 15000)`,
        [t.id, version, skuId, base.pcsId],
      )
    })
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO price_entry (tenant_id, version, sku_id, uom_id, outlet_id, price)
           VALUES ($1, $2, $3, $4, NULL, 16000)`,
          [t.id, version, skuId, base.pcsId],
        )
      }),
    ).rejects.toMatchObject({ code: '23505' })

    // Availability: NULLS NOT DISTINCT product-level duplicate rejected & mismatched SKU-product override rejected
    const otherProdAndSku = await masterTx(t.id, async (client, version) => {
      const p2 = (
        await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id)
           VALUES ($1, $2, $3, 'TEA01', 'Tea', $4) RETURNING id`,
          [t.id, version, base.catId, base.pcsId],
        )
      ).rows[0]!.id
      const s2 = (
        await client.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, 'TEA01-DEF', true) RETURNING id`,
          [t.id, version, p2],
        )
      ).rows[0]!.id
      return { p2, s2 }
    })

    await masterTx(t.id, async (client, version) => {
      await client.query(
        `INSERT INTO item_outlet_availability (tenant_id, version, outlet_id, product_id, sku_id, status)
         VALUES ($1, $2, $3, $4, NULL, 'AVAILABLE')`,
        [t.id, version, outletId, base.prodId],
      )
    })
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO item_outlet_availability (tenant_id, version, outlet_id, product_id, sku_id, status)
           VALUES ($1, $2, $3, $4, NULL, 'UNAVAILABLE')`,
          [t.id, version, outletId, base.prodId],
        )
      }),
    ).rejects.toMatchObject({ code: '23505' })

    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO item_outlet_availability (tenant_id, version, outlet_id, product_id, sku_id, status)
           VALUES ($1, $2, $3, $4, $5, 'UNAVAILABLE')`,
          [t.id, version, outletId, base.prodId, otherProdAndSku.s2],
        )
      }),
    ).rejects.toMatchObject({ code: '23503' })

    // feature_flag rules
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO feature_flag (tenant_id, version, flag_key, enabled)
           VALUES ($1, $2, 'A', true)`,
          [t.id, version],
        )
      }),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO feature_flag (tenant_id, version, flag_key, enabled, params)
           VALUES ($1, $2, 'pos.sample_flag', true, '["not_an_object"]'::jsonb)`,
          [t.id, version],
        )
      }),
    ).rejects.toMatchObject({ code: '23514' })

    await masterTx(t.id, async (client, version) => {
      await client.query(
        `INSERT INTO feature_flag (tenant_id, version, flag_key, enabled, params)
         VALUES ($1, $2, 'pos.sample_flag', true, '{"threshold":5}'::jsonb)`,
        [t.id, version],
      )
    })
    await expect(
      masterTx(t.id, async (client, version) => {
        await client.query(
          `INSERT INTO feature_flag (tenant_id, version, flag_key, enabled)
           VALUES ($1, $2, 'pos.sample_flag', false)`,
          [t.id, version],
        )
      }),
    ).rejects.toMatchObject({ code: '23505' })
    void boxId
  })

  it('enforces master_version_guard on every new Class M catalog/feature table', async () => {
    const t = await createTestTenant(uniqueSlug('cat-mvg'))
    const { outletId } = await seedOutlet(t.id)
    const base = await seedBaseCatalog(t.id, { hasVariants: false })
    const skuId = await masterTx(t.id, async (client, version) => {
      const s = (
        await client.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, 'MVG-SKU', true) RETURNING id`,
          [t.id, version, base.prodId],
        )
      ).rows[0]!.id
      await client.query(
        `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base)
         VALUES ($1, $2, $3, $4, 1, true)`,
        [t.id, version, s, base.pcsId],
      )
      return s
    })

    const badVersion = 999999
    const directStatements = [
      sql`INSERT INTO category (tenant_id, version, name) VALUES (${t.id}::uuid, ${badVersion}, 'BadCat')`,
      sql`INSERT INTO uom (tenant_id, version, code, name) VALUES (${t.id}::uuid, ${badVersion}, 'bad', 'Bad')`,
      sql`INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id) VALUES (${t.id}::uuid, ${badVersion}, ${base.catId}::uuid, 'BADP', 'Bad', ${base.pcsId}::uuid)`,
      sql`INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES (${t.id}::uuid, ${badVersion}, ${base.prodId}::uuid, 'BADS', false)`,
      sql`INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base) VALUES (${t.id}::uuid, ${badVersion}, ${skuId}::uuid, ${base.dusId}::uuid, 12, false)`,
      sql`INSERT INTO item_outlet_availability (tenant_id, version, outlet_id, product_id, status) VALUES (${t.id}::uuid, ${badVersion}, ${outletId}::uuid, ${base.prodId}::uuid, 'AVAILABLE')`,
      sql`INSERT INTO price_entry (tenant_id, version, sku_id, uom_id, price) VALUES (${t.id}::uuid, ${badVersion}, ${skuId}::uuid, ${base.pcsId}::uuid, 1000)`,
      sql`INSERT INTO feature_flag (tenant_id, version, flag_key, enabled) VALUES (${t.id}::uuid, ${badVersion}, 'pos.bad_ver', true)`,
    ]

    for (const stmt of directStatements) {
      await expect(
        withTestTenant(t.id, async (tx) => {
          await tx.execute(stmt)
        }),
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/does not match tenant_sync version/) },
      })
    }
  })
})
