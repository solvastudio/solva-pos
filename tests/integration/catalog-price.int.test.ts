import { sql } from 'drizzle-orm'
import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator, toMoney } from '~/lib/kernel'
import {
  addSkuUom,
  type CatalogActor,
  clearOutletPrice,
  createCategory,
  createProduct,
  createUom,
  getEffectivePrice,
  listPricesForSku,
  setPrice,
  setPricesBulk,
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
import { uniqueSlug, withTestTenant } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-cat-price@example.test' }

async function setupPriceTenant(prefix: string) {
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
  const le = await createLegalEntity(idActor, { name: 'PT Harga', isPkp: false })
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

  return { tenantId: created.tenantId, owner, outletA, outletB }
}

async function getTenantVersion(tenantId: string): Promise<number> {
  return withTestTenant(tenantId, async (tx) => {
    const res = await tx.execute(
      sql`SELECT version FROM tenant_sync WHERE tenant_id = ${tenantId}::uuid`,
    )
    return Number((res.rows[0] as { version: string | number }).version)
  })
}

describe('catalog-price integration (tier resolution, NO_PRICE, tombstone revival, bulk, open price)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    resetCompositionForTests()
    await closePools()
  })

  it('resolves outlet override > default > NO_PRICE without conversion multiplication, supports tombstone revival and bulk updates', async () => {
    const { tenantId, owner, outletA, outletB } = await setupPriceTenant('cprice1')
    const cat = await createCategory(owner, { name: 'Beverages' })
    const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces' })
    const dus = await createUom(owner, { code: 'dus', name: 'Dus' })
    const box = await createUom(owner, { code: 'box', name: 'Box' })

    const prod = await createProduct(owner, {
      categoryId: cat.id,
      code: 'KOP-1',
      name: 'Kopi Botol',
      baseUomId: pcs.id,
    })
    const sku = prod.skus[0]!
    await addSkuUom(owner, { skuId: sku.id, uomId: dus.id, conversionFactor: '12' })
    await addSkuUom(owner, { skuId: sku.id, uomId: box.id, conversionFactor: '24' })

    // No price yet -> NO_PRICE
    expect(
      await getEffectivePrice(owner, { skuId: sku.id, uomId: pcs.id, outletId: outletA.id }),
    ).toEqual({ kind: 'NO_PRICE' })

    // Default price pcs = 15000, dus = 160000 (not 12 * 15000 = 180000!)
    await setPrice(owner, { skuId: sku.id, uomId: pcs.id, price: 15000 })
    await setPrice(owner, { skuId: sku.id, uomId: dus.id, price: 160000 })

    // Outlet A override for pcs = 17000
    await setPrice(owner, {
      skuId: sku.id,
      uomId: pcs.id,
      outletId: outletA.id,
      price: 17000,
      reasonText: 'Airport outlet markup',
    })

    expect(
      await getEffectivePrice(owner, { skuId: sku.id, uomId: pcs.id, outletId: outletA.id }),
    ).toEqual({ kind: 'PRICE', price: toMoney(17000), source: 'OUTLET' })
    expect(
      await getEffectivePrice(owner, { skuId: sku.id, uomId: pcs.id, outletId: outletB.id }),
    ).toEqual({ kind: 'PRICE', price: toMoney(15000), source: 'DEFAULT' })
    expect(
      await getEffectivePrice(owner, { skuId: sku.id, uomId: dus.id, outletId: outletB.id }),
    ).toEqual({ kind: 'PRICE', price: toMoney(160000), source: 'DEFAULT' })
    expect(
      await getEffectivePrice(owner, { skuId: sku.id, uomId: box.id, outletId: outletA.id }),
    ).toEqual({ kind: 'NO_PRICE' })

    // Clear Outlet A override -> falls back to default 15000
    await clearOutletPrice(owner, { skuId: sku.id, uomId: pcs.id, outletId: outletA.id })
    expect(
      await getEffectivePrice(owner, { skuId: sku.id, uomId: pcs.id, outletId: outletA.id }),
    ).toEqual({ kind: 'PRICE', price: toMoney(15000), source: 'DEFAULT' })

    // Re-set Outlet A override -> tombstone revival succeeds cleanly
    const revived = await setPrice(owner, {
      skuId: sku.id,
      uomId: pcs.id,
      outletId: outletA.id,
      price: 18500,
    })
    expect(revived.price).toBe(18500)
    expect(
      await getEffectivePrice(owner, { skuId: sku.id, uomId: pcs.id, outletId: outletA.id }),
    ).toEqual({ kind: 'PRICE', price: toMoney(18500), source: 'OUTLET' })

    // Bulk price update -> +1 version bump only
    const versionBefore = await getTenantVersion(tenantId)
    const bulkRes = await setPricesBulk(owner, {
      outletId: outletB.id,
      items: [
        { skuId: sku.id, uomId: pcs.id, price: 14500 },
        { skuId: sku.id, uomId: dus.id, price: 155000 },
        { skuId: sku.id, uomId: box.id, price: 300000 },
      ],
    })
    const versionAfter = await getTenantVersion(tenantId)
    expect(bulkRes.entries).toHaveLength(3)
    expect(versionAfter).toBe(versionBefore + 1)

    expect((await listPricesForSku(owner, sku.id)).length).toBeGreaterThanOrEqual(6)

    const priceAudits = await withTestTenant(tenantId, async (tx) => {
      const res = await tx.execute(
        sql`SELECT action FROM audit_log WHERE tenant_id = ${tenantId}::uuid AND action = 'price.changed'`,
      )
      return res.rows as Array<{ action: string }>
    })
    // 2 default + 1 override + 1 clear + 1 revive + 3 bulk = 8
    expect(priceAudits).toHaveLength(8)
  })

  it('supports open-price products with no master price_entry or optional suggested price', async () => {
    const { owner, outletA } = await setupPriceTenant('cprice2')
    const cat = await createCategory(owner, { name: 'Services' })
    const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces' })

    const openProd = await createProduct(owner, {
      categoryId: cat.id,
      code: 'SVC-OPEN',
      name: 'Jasa Custom',
      baseUomId: pcs.id,
      isOpenPrice: true,
    })
    const openSku = openProd.skus[0]!

    expect(
      await getEffectivePrice(owner, { skuId: openSku.id, uomId: pcs.id, outletId: outletA.id }),
    ).toEqual({ kind: 'OPEN_PRICE', suggested: null })

    await setPrice(owner, { skuId: openSku.id, uomId: pcs.id, price: 25000 })
    expect(
      await getEffectivePrice(owner, { skuId: openSku.id, uomId: pcs.id, outletId: outletA.id }),
    ).toEqual({ kind: 'OPEN_PRICE', suggested: toMoney(25000) })
  })
})
