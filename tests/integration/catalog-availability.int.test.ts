import { sql } from 'drizzle-orm'
import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  addAttributeValue,
  type CatalogActor,
  clearSkuOverride,
  createCategory,
  createProduct,
  createUom,
  listEffectiveVisibleSkusForOutlet,
  listOutletAvailabilityRows,
  saveAvailabilityAcrossOutlets,
  setProductAvailability,
  setSkuOverride,
  updateProduct,
  updateSku,
} from '~/modules/catalog/public'
import {
  createLegalEntity,
  createOutlet,
  createTenant,
  getTenantAuthMetadataBySlug,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { masterTx } from './helpers/master'
import { uniqueSlug, withTestTenant } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-cat-avail@example.test' }

async function setupAvailabilityTenant(prefix: string) {
  const slug = uniqueSlug(prefix)
  const created = await createTenant(testOp, {
    name: `Tenant ${prefix}`,
    slug,
    ownerEmail: `owner-${slug}@example.test`,
    ownerDisplayName: 'Owner',
  })
  const meta = await getTenantAuthMetadataBySlug(slug)
  const idActor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }
  const le = await createLegalEntity(idActor, { name: 'PT Avail', isPkp: false })
  const outletA = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUTA',
    name: 'Outlet A',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const outletB = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUTB',
    name: 'Outlet B',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })

  const owner: CatalogActor = {
    tenantId: created.tenantId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(['catalog.manage']),
    outletIds: null,
  }

  return { tenantId: created.tenantId, idActor, le, owner, outletA, outletB }
}

async function getTenantVersion(tenantId: string): Promise<number> {
  return withTestTenant(tenantId, async (tx) => {
    const res = await tx.execute(
      sql`SELECT version FROM tenant_sync WHERE tenant_id = ${tenantId}::uuid`,
    )
    return Number((res.rows[0] as { version: string | number }).version)
  })
}

describe('catalog-availability integration (V-27 DB end-to-end, 4,000-product seed, EC-049)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    resetCompositionForTests()
    await closePools()
  })

  it('executes V-27 visibility transitions end-to-end against PostgreSQL', async () => {
    const { owner, outletA, outletB } = await setupAvailabilityTenant('cavail1')
    const cat = await createCategory(owner, { name: 'Apparel' })
    const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces' })

    // Kaos 3 x 2 = 6 SKUs
    const kaos = await createProduct(owner, {
      categoryId: cat.id,
      code: 'KAOS',
      name: 'Kaos Signature',
      hasVariants: true,
      baseUomId: pcs.id,
      attributes: [
        { name: 'Size', values: ['S', 'M', 'L'] },
        { name: 'Warna', values: ['Merah', 'Hitam'] },
      ],
    })
    expect(kaos.skus).toHaveLength(6)

    // Both outlets AVAILABLE initially -> 6 vs 6
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletA.id, kaos.product.id)).toHaveLength(6)
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletB.id, kaos.product.id)).toHaveLength(6)

    // Outlet B product-level UNAVAILABLE + 3 Merah SKU overrides AVAILABLE -> Outlet A = 6, Outlet B = 3
    await setProductAvailability(owner, {
      outletId: outletB.id,
      productId: kaos.product.id,
      status: 'UNAVAILABLE',
    })
    const merahSkus = kaos.skus.filter((s) => s.variantLabel?.includes('Merah'))
    for (const s of merahSkus) {
      await setSkuOverride(owner, {
        outletId: outletB.id,
        productId: kaos.product.id,
        skuId: s.id,
        status: 'AVAILABLE',
      })
    }
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletA.id, kaos.product.id)).toHaveLength(6)
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletB.id, kaos.product.id)).toHaveLength(3)

    // Clear overrides on Outlet B + make product AVAILABLE -> Outlet A = 6, Outlet B = 6
    for (const s of merahSkus) {
      await clearSkuOverride(owner, {
        outletId: outletB.id,
        productId: kaos.product.id,
        skuId: s.id,
      })
    }
    await setProductAvailability(owner, {
      outletId: outletB.id,
      productId: kaos.product.id,
      status: 'AVAILABLE',
    })
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletA.id, kaos.product.id)).toHaveLength(6)
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletB.id, kaos.product.id)).toHaveLength(6)

    // Hide the 3 Hitam SKUs via UNAVAILABLE overrides at Outlet B, then add XL (+2 SKUs) -> A=8, B=5 -> clear -> A=8, B=8
    const hitamSkus = kaos.skus.filter((s) => s.variantLabel?.includes('Hitam'))
    for (const s of hitamSkus) {
      await setSkuOverride(owner, {
        outletId: outletB.id,
        productId: kaos.product.id,
        skuId: s.id,
        status: 'UNAVAILABLE',
      })
    }
    const sizeAttr = kaos.attributes.find((a) => a.attribute.name === 'Size')!
    await addAttributeValue(owner, {
      productId: kaos.product.id,
      attributeId: sizeAttr.attribute.id,
      value: 'XL',
    })
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletA.id, kaos.product.id)).toHaveLength(8)
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletB.id, kaos.product.id)).toHaveLength(5)

    for (const s of hitamSkus) {
      await clearSkuOverride(owner, {
        outletId: outletB.id,
        productId: kaos.product.id,
        skuId: s.id,
      })
    }
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletA.id, kaos.product.id)).toHaveLength(8)
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletB.id, kaos.product.id)).toHaveLength(8)

    // Global inactive SKU (even with AVAILABLE override) loses -> 1 vs 0 on single SKU check
    const singleSku = hitamSkus[0]!
    await setSkuOverride(owner, {
      outletId: outletA.id,
      productId: kaos.product.id,
      skuId: singleSku.id,
      status: 'AVAILABLE',
    })
    await updateSku(owner, { skuId: singleSku.id, isActive: false })
    const visA = await listEffectiveVisibleSkusForOutlet(owner, outletA.id, kaos.product.id)
    expect(visA.some((s) => s.id === singleSku.id)).toBe(false)

    // Global inactive product forces 0 visible SKUs even with AVAILABLE overrides on Outlet A
    await updateProduct(owner, { id: kaos.product.id, isActive: false })
    expect(await listEffectiveVisibleSkusForOutlet(owner, outletA.id, kaos.product.id)).toHaveLength(0)
  })

  it('seeds 4,000 active products on new outlet creation via set-based SQL in 1 version bump < 10s', async () => {
    const { tenantId, idActor, le, owner } = await setupAvailabilityTenant('cavail4k')
    const cat = await createCategory(owner, { name: 'BulkCat' })
    const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces' })

    // Insert 4,000 active products + 1 inactive product via masterTx as test fixture setup
    await masterTx(tenantId, async (client, version) => {
      await client.query(
        `INSERT INTO product (
           id, tenant_id, version, created_at, updated_at, created_by, updated_by,
           category_id, code, name, product_type, has_variants, base_uom_id, is_active
         )
         SELECT
           uuidv7(), $1::uuid, $5, now(), now(), $2::uuid, $2::uuid,
           $3::uuid, 'BLK-' || g::text, 'Bulk Item ' || g::text, 'RETAIL', false, $4::uuid,
           (g <= 4000)
         FROM generate_series(1, 4001) AS g`,
        [tenantId, owner.appUserId, cat.id, pcs.id, version],
      )
    })

    const versionBefore = await getTenantVersion(tenantId)
    const startMs = Date.now()
    const newOutlet = await createOutlet(idActor, {
      legalEntityId: le.id,
      code: 'OUTNEW',
      name: 'New Branch',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '00:00',
      priceTaxMode: 'INCLUSIVE',
    })
    const durationMs = Date.now() - startMs
    const versionAfter = await getTenantVersion(tenantId)

    expect(durationMs).toBeLessThan(10_000)
    expect(versionAfter).toBe(versionBefore + 1)

    const seeded = await listOutletAvailabilityRows(owner, newOutlet.id)
    expect(seeded).toHaveLength(4000)
    expect(seeded.every((r) => r.status === 'AVAILABLE' && r.skuId === null)).toBe(true)
  })

  it('serializes parallel availability edits on same (outlet, product) (EC-049) with server changed_at and both audited', async () => {
    const { tenantId, owner, outletA } = await setupAvailabilityTenant('cavailpar')
    const cat = await createCategory(owner, { name: 'Drinks' })
    const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces' })
    const prod = await createProduct(owner, {
      categoryId: cat.id,
      code: 'TEH-1',
      name: 'Teh',
      baseUomId: pcs.id,
    })

    const serverClockA = '2026-11-20T08:00:00.000Z'
    const serverClockB = '2026-11-20T08:00:05.000Z'

    const [res1, res2] = await Promise.all([
      setProductAvailability(
        owner,
        { outletId: outletA.id, productId: prod.product.id, status: 'UNAVAILABLE' },
        { nowIso: () => serverClockA },
      ),
      setProductAvailability(
        owner,
        { outletId: outletA.id, productId: prod.product.id, status: 'AVAILABLE' },
        { nowIso: () => serverClockB },
      ),
    ])

    expect(res1.version).not.toBe(res2.version)
    expect([res1.changedAt, res2.changedAt]).toEqual(
      expect.arrayContaining(['2026-11-20T08:00:00.000Z', '2026-11-20T08:00:05.000Z']),
    )

    const audits = await withTestTenant(tenantId, async (tx) => {
      const res = await tx.execute(
        sql`SELECT action, after_data FROM audit_log WHERE tenant_id = ${tenantId}::uuid AND action = 'availability.changed' ORDER BY chain_seq ASC`,
      )
      return res.rows as Array<{ action: string; after_data: Record<string, unknown> }>
    })
    expect(audits).toHaveLength(2)
  })

  it('saves availability across outlets atomically and rolls back all changes on invalid target', async () => {
    const { owner, outletA, outletB } = await setupAvailabilityTenant('cavailatom1')
    const cat = await createCategory(owner, { name: 'Drinks' })
    const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces' })
    const prod = await createProduct(owner, {
      categoryId: cat.id,
      code: 'KOPI-ATOM',
      name: 'Kopi Atom',
      baseUomId: pcs.id,
    })

    await expect(
      saveAvailabilityAcrossOutlets(owner, {
        updates: [
          { outletId: outletA.id, productId: prod.product.id, status: 'UNAVAILABLE' },
          { outletId: outletB.id, productId: testIdGen.newId(), status: 'UNAVAILABLE' },
        ],
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof AppError && err.code === 'VALIDATION_FAILED')

    const outletARows = await listOutletAvailabilityRows(owner, outletA.id)
    expect(outletARows.find((r) => r.productId === prod.product.id && r.skuId === null)?.status).toBe(
      'AVAILABLE',
    )
  })

  it('applies updates and clears SKU overrides across outlets in one transaction', async () => {
    const { owner, outletA, outletB } = await setupAvailabilityTenant('cavailatom2')
    const cat = await createCategory(owner, { name: 'Apparel' })
    const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces' })
    const kaos = await createProduct(owner, {
      categoryId: cat.id,
      code: 'KAOS-ATOM',
      name: 'Kaos Atom',
      hasVariants: true,
      baseUomId: pcs.id,
      attributes: [{ name: 'Size', values: ['S', 'M'] }],
    })
    const targetSku = kaos.skus[0]!
    await setSkuOverride(owner, {
      outletId: outletB.id,
      productId: kaos.product.id,
      skuId: targetSku.id,
      status: 'UNAVAILABLE',
    })

    const saved = await saveAvailabilityAcrossOutlets(owner, {
      updates: [{ outletId: outletA.id, productId: kaos.product.id, status: 'UNAVAILABLE' }],
      clears: [{ outletId: outletB.id, productId: kaos.product.id, skuId: targetSku.id }],
    })

    expect(saved.savedCount).toBe(2)
    const outletARows = await listOutletAvailabilityRows(owner, outletA.id)
    expect(outletARows.find((r) => r.productId === kaos.product.id && r.skuId === null)?.status).toBe(
      'UNAVAILABLE',
    )
    const outletBRows = await listOutletAvailabilityRows(owner, outletB.id)
    expect(outletBRows.some((r) => r.skuId === targetSku.id)).toBe(false)
  })
})
