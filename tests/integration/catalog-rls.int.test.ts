import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closePools } from '~/server/db'
import { masterTx } from './helpers/master'
import { createTestTenant, uniqueSlug, withTestTenant } from './helpers/tenants'

const CATALOG_TENANT_TABLES = [
  'category',
  'uom',
  'product',
  'product_attribute',
  'attribute_value',
  'sku',
  'sku_attribute_value',
  'sku_uom',
  'item_outlet_availability',
  'price_entry',
  'feature_flag',
] as const

async function seedFullCatalogTenant(tenantId: string, prefix: string) {
  return masterTx(tenantId, async (client, version) => {
    const leId = (
      await client.query<{ id: string }>(
        `INSERT INTO legal_entity (tenant_id, version, name) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, version, `Entity ${prefix}`],
      )
    ).rows[0]!.id
    const outletId = (
      await client.query<{ id: string }>(
        `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode)
         VALUES ($1, $2, $3, $4, $5, 'INCLUSIVE') RETURNING id`,
        [tenantId, version, leId, `${prefix}1`, `Outlet ${prefix}`],
      )
    ).rows[0]!.id
    const catId = (
      await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, version, `Cat ${prefix}`],
      )
    ).rows[0]!.id
    const pcsId = (
      await client.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pieces') RETURNING id`,
        [tenantId, version],
      )
    ).rows[0]!.id
    const prodId = (
      await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id, has_variants)
         VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
        [tenantId, version, catId, `${prefix}-P1`, `Product ${prefix}`, pcsId],
      )
    ).rows[0]!.id
    const attrId = (
      await client.query<{ id: string }>(
        `INSERT INTO product_attribute (tenant_id, product_id, name) VALUES ($1, $2, 'Size') RETURNING id`,
        [tenantId, prodId],
      )
    ).rows[0]!.id
    const attrValId = (
      await client.query<{ id: string }>(
        `INSERT INTO attribute_value (tenant_id, attribute_id, value) VALUES ($1, $2, 'Regular') RETURNING id`,
        [tenantId, attrId],
      )
    ).rows[0]!.id
    const skuId = (
      await client.query<{ id: string }>(
        `INSERT INTO sku (tenant_id, version, product_id, sku_code, variant_label, is_default)
         VALUES ($1, $2, $3, $4, 'Regular', false) RETURNING id`,
        [tenantId, version, prodId, `${prefix}-SKU1`],
      )
    ).rows[0]!.id
    await client.query(
      `INSERT INTO sku_attribute_value (tenant_id, sku_id, attribute_value_id) VALUES ($1, $2, $3)`,
      [tenantId, skuId, attrValId],
    )
    await client.query(
      `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base, barcode)
       VALUES ($1, $2, $3, $4, 1, true, $5)`,
      [tenantId, version, skuId, pcsId, `${prefix}-BC1`],
    )
    await client.query(
      `INSERT INTO item_outlet_availability (tenant_id, version, outlet_id, product_id, sku_id, status)
       VALUES ($1, $2, $3, $4, NULL, 'AVAILABLE')`,
      [tenantId, version, outletId, prodId],
    )
    await client.query(
      `INSERT INTO price_entry (tenant_id, version, sku_id, uom_id, outlet_id, price)
       VALUES ($1, $2, $3, $4, $5, 25000)`,
      [tenantId, version, skuId, pcsId, outletId],
    )
    await client.query(
      `INSERT INTO feature_flag (tenant_id, version, flag_key, enabled)
       VALUES ($1, $2, 'pos.test_isolation', true)`,
      [tenantId, version],
    )
    return { outletId, catId, pcsId, prodId, attrId, attrValId, skuId, version }
  })
}

describe('catalog & feature_flag RLS isolation and composite tenant FKs (Phase 31)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('isolates all 11 tables across tenants, blocks cross-tenant writes, and rejects cross-tenant composite FKs', async () => {
    const tenantA = await createTestTenant(uniqueSlug('cata'))
    const tenantB = await createTestTenant(uniqueSlug('catb'))

    const b = await seedFullCatalogTenant(tenantB.id, 'TB')
    const a = await seedFullCatalogTenant(tenantA.id, 'TA')

    // Tenant A queries must NEVER see Tenant B rows (counts strictly reflect Tenant A's 1 row each)
    await withTestTenant(tenantA.id, async (tx) => {
      for (const table of CATALOG_TENANT_TABLES) {
        const res = await tx.execute(sql.raw(`SELECT count(*)::int AS cnt FROM "${table}"`))
        expect(res.rows[0], `Tenant A should only see its own row in ${table}`).toMatchObject({
          cnt: 1,
        })
      }
    })

    // Writing with Tenant B's tenant_id inside Tenant A's context fails for Class S (RLS 42501) and Class M (version guard P0001)
    await expect(
      withTestTenant(tenantA.id, async (tx) => {
        await tx.execute(
          sql`INSERT INTO product_attribute (tenant_id, product_id, name)
              VALUES (${tenantB.id}::uuid, ${b.prodId}::uuid, 'CrossAttr')`,
        )
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } })

    await expect(
      withTestTenant(tenantA.id, async (tx) => {
        await tx.execute(
          sql`INSERT INTO feature_flag (tenant_id, version, flag_key, enabled)
              VALUES (${tenantB.id}::uuid, ${b.version}, 'pos.cross_tenant', true)`,
        )
      }),
    ).rejects.toMatchObject({ cause: { code: 'P0001' } })

    // Cross-tenant composite FKs rejected cleanly (SQLSTATE 23503) even from owner/valid tenant version
    await expect(
      masterTx(tenantA.id, async (client, version) => {
        await client.query(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id)
           VALUES ($1, $2, $3, 'CROSS-CAT', 'Cross Category', $4)`,
          [tenantA.id, version, b.catId, a.pcsId],
        )
      }),
    ).rejects.toMatchObject({ code: '23503' })

    await expect(
      masterTx(tenantA.id, async (client, version) => {
        await client.query(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, 'CROSS-SKU', false)`,
          [tenantA.id, version, b.prodId],
        )
      }),
    ).rejects.toMatchObject({ code: '23503' })

    await expect(
      masterTx(tenantA.id, async (client, version) => {
        await client.query(
          `INSERT INTO price_entry (tenant_id, version, sku_id, uom_id, outlet_id, price)
           VALUES ($1, $2, $3, $4, $5, 1000)`,
          [tenantA.id, version, a.skuId, a.pcsId, b.outletId],
        )
      }),
    ).rejects.toMatchObject({ code: '23503' })

    await expect(
      masterTx(tenantA.id, async (client, version) => {
        await client.query(
          `INSERT INTO item_outlet_availability (tenant_id, version, outlet_id, product_id, sku_id, status)
           VALUES ($1, $2, $3, $4, NULL, 'UNAVAILABLE')`,
          [tenantA.id, version, b.outletId, a.prodId],
        )
      }),
    ).rejects.toMatchObject({ code: '23503' })

    // Verify DELETE privilege distinction for solva_app_login
    await expect(
      withTestTenant(tenantA.id, async (tx) => {
        await tx.execute(sql`DELETE FROM category WHERE id = ${a.catId}::uuid`)
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } })

    await withTestTenant(tenantA.id, async (tx) => {
      await tx.execute(sql`DELETE FROM item_outlet_availability WHERE outlet_id = ${a.outletId}::uuid`)
      await tx.execute(sql`DELETE FROM sku_attribute_value WHERE sku_id = ${a.skuId}::uuid`)
    })
  })
})
