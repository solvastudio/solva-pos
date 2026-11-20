import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  type CatalogActor,
  createCategory,
  createProduct,
  createUom,
  getAdminProductDetail,
  getAvailabilityMatrix,
  getPriceMatrix,
  listAdminProducts,
  setPrice,
  setProductAvailability,
  setSkuOverride,
} from '~/modules/catalog/public'
import {
  createLegalEntity,
  createOutlet,
  createTenant,
  getTenantAuthMetadataBySlug,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { writeMaster } from '~/modules/sync/public'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-cat-qry@example.test' }

async function setupQueryTenant(prefix: string) {
  const slug = uniqueSlug(prefix)
  const created = await createTenant(testOp, {
    name: `Query ${slug}`,
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
  const owner: CatalogActor = {
    tenantId: created.tenantId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(['catalog.manage']),
    outletIds: null,
  }
  const le = await createLegalEntity(idActor, { name: 'PT Query', isPkp: false })
  const outA = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUTA',
    name: 'Outlet A',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const outB = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUTB',
    name: 'Outlet B',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })

  return { tenantId: created.tenantId, owner, outA, outB }
}

describe('catalog-query integration (5,000-product list speed, matrix filters, Manager scope, tenant isolation)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    resetCompositionForTests()
    await closePools()
  })

  it('lists 5,000 synthetic products in <= 300ms with accurate price/availability aggregates and tenant isolation', async () => {
    const fx = await setupQueryTenant('cq5k')
    const fxOther = await setupQueryTenant('cqother')
    const cat = await createCategory(fx.owner, { name: 'Mass' })
    const pcs = await createUom(fx.owner, { code: 'pcs', name: 'Pieces' })
    const nowIso = new Date().toISOString()

    // Seed 5,000 synthetic products in one writeMaster
    await withTenant(fx.tenantId, async (tx) => {
      await writeMaster(tx, { actorUserId: fx.owner.appUserId }, async (w) => {
        await tx.execute(sql`
          INSERT INTO product (
            id, tenant_id, version, created_at, updated_at, created_by, updated_by,
            category_id, code, name, product_type, has_variants, base_uom_id, sort_order
          )
          SELECT
            uuidv7(), ${w.tenantId}::uuid, ${w.version}::bigint, ${nowIso}::timestamptz, ${nowIso}::timestamptz,
            ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${cat.id}::uuid,
            'Q-' || lpad(g::text, 4, '0'), 'Query Product ' || g::text, 'RETAIL', false, ${pcs.id}::uuid, g
          FROM generate_series(1, 5000) AS g
        `)
      })
    })

    const t0 = Date.now()
    const res = await listAdminProducts(fx.owner, { page: 1, pageSize: 50 })
    const elapsedMs = Date.now() - t0

    expect(res.total).toBe(5000)
    expect(res.items).toHaveLength(50)
    expect(elapsedMs).toBeLessThanOrEqual(300)

    // Tenant isolation: other tenant sees 0 products
    const otherRes = await listAdminProducts(fxOther.owner, { page: 1, pageSize: 50 })
    expect(otherRes.total).toBe(0)
  })

  it('aggregates prices & availability correctly, filters price/availability matrices, and enforces Manager outlet scope', async () => {
    const fx = await setupQueryTenant('cqmat')
    const catParent = await createCategory(fx.owner, { name: 'Apparel' })
    const catChild = await createCategory(fx.owner, { name: 'Shirts', parentId: catParent.id })
    const pcs = await createUom(fx.owner, { code: 'pcs', name: 'Pieces' })

    const kaos = await createProduct(fx.owner, {
      categoryId: catChild.id,
      code: 'KAOS',
      name: 'Kaos',
      hasVariants: true,
      baseUomId: pcs.id,
      attributes: [{ name: 'Size', values: ['S', 'M'] }],
    })
    const topi = await createProduct(fx.owner, {
      categoryId: catParent.id,
      code: 'TOPI',
      name: 'Topi',
      baseUomId: pcs.id,
    })

    const sSku = kaos.skus[0]!
    const mSku = kaos.skus[1]!
    await setPrice(fx.owner, { skuId: sSku.id, uomId: pcs.id, price: 50000 })
    await setPrice(fx.owner, {
      skuId: mSku.id,
      uomId: pcs.id,
      outletId: fx.outB.id,
      price: 65000,
    })

    await setProductAvailability(fx.owner, {
      outletId: fx.outB.id,
      productId: kaos.product.id,
      status: 'UNAVAILABLE',
    })
    await setSkuOverride(fx.owner, {
      outletId: fx.outB.id,
      productId: kaos.product.id,
      skuId: sSku.id,
      status: 'AVAILABLE',
    })

    // Product list priceRange & availability summary (parent category includes child)
    const listOwner = await listAdminProducts(fx.owner, { categoryId: catParent.id })
    expect(listOwner.total).toBe(2)
    const kaosSummary = listOwner.items.find((i) => i.id === kaos.product.id)!
    expect(kaosSummary.categoryPath).toBe('Apparel > Shirts')
    expect(kaosSummary.skuCount).toBe(2)
    expect(kaosSummary.priceRange).toEqual({ min: 50000, max: 65000 })
    expect(kaosSummary.availability).toEqual({ available: 1, total: 2 })

    // Price matrix onlyMissing filter
    const missingPrices = await getPriceMatrix(fx.owner, { onlyMissing: true })
    expect(missingPrices.rows.map((r) => r.skuId).sort()).toEqual([mSku.id, topi.skus[0]!.id].sort())

    // Availability matrix loads SKU overrides & respects onlyExceptions
    const exAvail = await getAvailabilityMatrix(fx.owner, { onlyExceptions: true })
    expect(exAvail.rows).toHaveLength(1)
    expect(exAvail.rows[0]!.productId).toBe(kaos.product.id)
    expect(exAvail.rows[0]!.effectiveCounts[fx.outB.id]).toEqual({ available: 1, total: 2 })

    // Manager scoped to Outlet A sees ONLY Outlet A in priceMatrix, scopedOutletIds=[outA] in availabilityMatrix, and getAdminProductDetail omits outB
    const managerA: CatalogActor = {
      tenantId: fx.tenantId,
      appUserId: fx.owner.appUserId,
      permissions: new Set(['catalog.manage']),
      outletIds: [fx.outA.id],
    }

    const mgrPrices = await getPriceMatrix(managerA)
    expect(mgrPrices.canEditDefault).toBe(false)
    expect(mgrPrices.outlets.map((o) => o.id)).toEqual([fx.outA.id])

    const mgrAvail = await getAvailabilityMatrix(managerA)
    expect(mgrAvail.scopedOutletIds).toEqual([fx.outA.id])
    expect(mgrAvail.outlets).toHaveLength(2) // displays locked columns

    const detailMgr = await getAdminProductDetail(managerA, kaos.product.id)
    expect(detailMgr?.outlets.map((o) => o.id)).toEqual([fx.outA.id])
    expect(detailMgr?.prices.some((p) => p.outletId === fx.outB.id)).toBe(false)
  })
})
