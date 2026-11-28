import { sql } from 'drizzle-orm'
import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator, normalizeQty, parseQty } from '~/lib/kernel'
import {
  __clearHasTransactionsPortForTests,
  addAttributeValue,
  addSkuUom,
  type CatalogActor,
  createCategory,
  createProduct,
  createUom,
  deleteCategory,
  deleteProduct,
  deleteUom,
  listCategories,
  listProductVariants,
  listSkuUoms,
  registerHasTransactionsPort,
  removeAttributeValue,
  removeSkuUom,
  setPrice,
  setProductAvailability,
  updateProduct,
  updateSkuUom,
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
import { uniqueSlug, withTestTenant } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-cat-prod@example.test' }

async function setupCatalogTenant(prefix: string) {
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
  const le = await createLegalEntity(idActor, { name: 'PT Catalog', isPkp: false })
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
  const outletC = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUTC',
    name: 'Outlet C',
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

  return { tenantId: created.tenantId, owner, outletA, outletB, outletC }
}

async function getTenantVersion(tenantId: string): Promise<number> {
  return withTestTenant(tenantId, async (tx) => {
    const res = await tx.execute(
      sql`SELECT version FROM tenant_sync WHERE tenant_id = ${tenantId}::uuid`,
    )
    return Number((res.rows[0] as { version: string | number }).version)
  })
}

async function listAuditActions(tenantId: string) {
  return withTestTenant(tenantId, async (tx) => {
    const res = await tx.execute(
      sql`SELECT action, entity_type, entity_id, outlet_id, after_data FROM audit_log WHERE tenant_id = ${tenantId}::uuid ORDER BY chain_seq ASC`,
    )
    return res.rows as Array<{
      action: string
      entity_type: string
      entity_id: string | null
      outlet_id: string | null
      after_data: Record<string, unknown> | null
    }>
  })
}

describe('catalog-products integration (products, variants, UOM/barcodes, permissions)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    resetCompositionForTests()
    await closePools()
  })

  it('creates Kopi Bubuk 200g across 3 outlets with excludeOutletIds=C in +1 version and single availability audit', async () => {
    const { tenantId, owner, outletA, outletB, outletC } = await setupCatalogTenant('catp1')
    const cat = await createCategory(owner, { name: 'Minuman' })
    const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces', allowFraction: false })

    const versionBefore = await getTenantVersion(tenantId)
    const created = await createProduct(owner, {
      categoryId: cat.id,
      code: 'KP-200',
      name: 'Kopi Bubuk 200g',
      productType: 'RETAIL',
      hasVariants: false,
      baseUomId: pcs.id,
      barcode: '899000111222',
      excludeOutletIds: [outletC.id],
    })
    const versionAfter = await getTenantVersion(tenantId)

    expect(versionAfter).toBe(versionBefore + 1)
    expect(created.skus).toHaveLength(1)
    expect(created.skus[0]!.isDefault).toBe(true)
    expect(created.skus[0]!.variantLabel).toBeNull()

    const skuUoms = await listSkuUoms(owner, created.skus[0]!.id)
    expect(skuUoms).toHaveLength(1)
    expect(skuUoms[0]!.isBase).toBe(true)
    expect(normalizeQty(parseQty(skuUoms[0]!.conversionFactor))).toBe('1')
    expect(skuUoms[0]!.barcode).toBe('899000111222')

    const availByOutlet = new Map(created.availability.map((a) => [a.outletId, a.status]))
    expect(availByOutlet.get(outletA.id)).toBe('AVAILABLE')
    expect(availByOutlet.get(outletB.id)).toBe('AVAILABLE')
    expect(availByOutlet.get(outletC.id)).toBe('UNAVAILABLE')

    const audits = await listAuditActions(tenantId)
    const productAudits = audits.filter((a) => a.entity_type === 'product')
    expect(productAudits).toHaveLength(0)

    const availAudits = audits.filter((a) => a.action === 'availability.changed')
    expect(availAudits).toHaveLength(1)
    expect(availAudits[0]!.outlet_id).toBe(outletC.id)
    expect(availAudits[0]!.after_data).toEqual({
      productId: created.product.id,
      skuId: null,
      status: 'UNAVAILABLE',
    })
  })

  it('generates Kaos 3x2 variants, adds XL (+2 SKUs), removes Hitam conditionally on HasTransactionsPort, and enforces 3/100 limits', async () => {
    const { owner } = await setupCatalogTenant('catv1')
    const cat = await createCategory(owner, { name: 'Pakaian' })
    const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces' })

    // Limit check: >3 attributes rejected
    await expect(
      createProduct(owner, {
        categoryId: cat.id,
        code: 'MAX4',
        name: 'Too Many Attrs',
        hasVariants: true,
        baseUomId: pcs.id,
        attributes: [
          { name: 'A1', values: ['1'] },
          { name: 'A2', values: ['2'] },
          { name: 'A3', values: ['3'] },
          { name: 'A4', values: ['4'] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    // Limit check: >100 SKU combinations rejected (11 x 10 = 110)
    await expect(
      createProduct(owner, {
        categoryId: cat.id,
        code: 'MAX110',
        name: 'Too Many SKUs',
        hasVariants: true,
        baseUomId: pcs.id,
        attributes: [
          { name: 'Size', values: Array.from({ length: 11 }, (_, i) => `S${i}`) },
          { name: 'Color', values: Array.from({ length: 10 }, (_, i) => `C${i}`) },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    // Valid Kaos 3 x 2 = 6 SKUs
    const kaos = await createProduct(owner, {
      categoryId: cat.id,
      code: 'KAOS',
      name: 'Kaos Polos',
      hasVariants: true,
      baseUomId: pcs.id,
      attributes: [
        { name: 'Size', values: ['S', 'M', 'L'] },
        { name: 'Warna', values: ['Merah', 'Hitam'] },
      ],
    })
    expect(kaos.skus).toHaveLength(6)
    expect(kaos.skus.every((s) => !s.isDefault)).toBe(true)

    const sizeAttr = kaos.attributes.find((a) => a.attribute.name === 'Size')!
    const warnaAttr = kaos.attributes.find((a) => a.attribute.name === 'Warna')!
    const hitamVal = warnaAttr.values.find((v) => v.value === 'Hitam')!

    // Add XL -> only 2 new SKUs
    const addXl = await addAttributeValue(owner, {
      productId: kaos.product.id,
      attributeId: sizeAttr.attribute.id,
      value: 'XL',
    })
    expect(addXl.createdSkus).toHaveLength(2)
    expect(addXl.createdSkus.map((s) => s.variantLabel)).toEqual(['XL / Merah', 'XL / Hitam'])

    const afterAdd = await listProductVariants(owner, kaos.product.id)
    expect(afterAdd.skus).toHaveLength(8)

    // Remove Hitam when HasTransactionsPort returns false -> tombstones 4 SKUs cleanly
    const removed = await removeAttributeValue(owner, {
      productId: kaos.product.id,
      attributeValueId: hitamVal.id,
    })
    expect(removed.removedSkuIds).toHaveLength(4)

    const afterRemove = await listProductVariants(owner, kaos.product.id)
    expect(afterRemove.skus).toHaveLength(4)

    // Block removing a value when HasTransactionsPort reports true for an affected SKU
    const smallVal = sizeAttr.values.find((v) => v.value === 'S')!
    const affectedSmallLink = afterRemove.links.find((l) => l.attributeValueId === smallVal.id)!
    __clearHasTransactionsPortForTests()
    registerHasTransactionsPort({
      hasTransactions: async (id) => id === affectedSmallLink.skuId,
    })

    await expect(
      removeAttributeValue(owner, {
        productId: kaos.product.id,
        attributeValueId: smallVal.id,
      }),
    ).rejects.toThrow(/admin\.catalog\.variantInUse/)
    const stillFour = await listProductVariants(owner, kaos.product.id)
    expect(stillFour.skus).toHaveLength(4)
  })

  it('enforces UOM conversion factor rules, unique barcodes, baseUomId immutability when transacted, category depth, and manager scope', async () => {
    const { owner, outletA, outletB } = await setupCatalogTenant('catu1')
    const catL1 = await createCategory(owner, { name: 'Minuman' })
    const catL2 = await createCategory(owner, { name: 'Kopi', parentId: catL1.id })

    // Depth 3 rejected
    await expect(
      createCategory(owner, { name: 'Arabika', parentId: catL2.id }),
    ).rejects.toThrow(/admin\.catalog\.categoryMaxDepth/)

    const categories = await listCategories(owner)
    expect(categories).toHaveLength(2)
    await expect(deleteCategory(owner, catL1.id)).rejects.toThrow(/admin\.catalog\.categoryHasChildren/)

    const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces' })
    const dus = await createUom(owner, { code: 'dus', name: 'Dus' })
    const box = await createUom(owner, { code: 'box', name: 'Box' })

    const prod1 = await createProduct(owner, {
      categoryId: catL2.id,
      code: 'P-1',
      name: 'Teh Botol',
      baseUomId: pcs.id,
    })
    const sku1 = prod1.skus[0]!

    const prod2 = await createProduct(owner, {
      categoryId: catL2.id,
      code: 'P-2',
      name: 'Air Mineral',
      baseUomId: pcs.id,
    })
    const sku2 = prod2.skus[0]!

    // Add UOM dus factor 12 + barcode
    const dusUom = await addSkuUom(owner, {
      skuId: sku1.id,
      uomId: dus.id,
      conversionFactor: '12',
      barcode: '899123456',
    })
    expect(normalizeQty(parseQty(dusUom.conversionFactor))).toBe('12')

    // Duplicate barcode rejected across SKUs
    await expect(
      addSkuUom(owner, {
        skuId: sku2.id,
        uomId: dus.id,
        conversionFactor: '24',
        barcode: '899123456',
      }),
    ).rejects.toThrow(/admin\.catalog\.barcodeTaken/)

    // Invalid conversion factors rejected
    await expect(
      addSkuUom(owner, { skuId: sku2.id, uomId: dus.id, conversionFactor: '0' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(
      addSkuUom(owner, { skuId: sku2.id, uomId: dus.id, conversionFactor: '1.12345' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    // Cannot remove base UOM
    const sku1Uoms = await listSkuUoms(owner, sku1.id)
    const baseSku1Uom = sku1Uoms.find((u) => u.isBase)!
    await expect(removeSkuUom(owner, baseSku1Uom.id)).rejects.toThrow(
      /admin\.catalog\.cannotRemoveBaseUom/,
    )

    // Removing non-base UOM tombstones both sku_uom and its price entries
    await setPrice(owner, { skuId: sku1.id, uomId: dus.id, price: 48000 })
    await removeSkuUom(owner, dusUom.id)
    expect(await listSkuUoms(owner, sku1.id)).toHaveLength(1)

    // Re-attaching dus with same barcode works after tombstone revival
    const revivedDus = await addSkuUom(owner, {
      skuId: sku1.id,
      uomId: dus.id,
      conversionFactor: '12',
      barcode: '899123456',
    })
    await updateSkuUom(owner, { id: revivedDus.id, conversionFactor: '12.5000' })
    const refreshed = await listSkuUoms(owner, sku1.id)
    expect(normalizeQty(parseQty(refreshed.find((u) => u.id === revivedDus.id)!.conversionFactor))).toBe('12.5')

    // baseUomId change allowed while hasTransactions === false
    await updateProduct(owner, { id: prod2.product.id, baseUomId: box.id })
    const sku2Uoms = await listSkuUoms(owner, sku2.id)
    expect(sku2Uoms[0]!.uomId).toBe(box.id)

    // baseUomId change and deleteProduct blocked when hasTransactions === true
    __clearHasTransactionsPortForTests()
    registerHasTransactionsPort({
      hasTransactions: async (id) => id === prod1.product.id,
    })
    await expect(
      updateProduct(owner, { id: prod1.product.id, baseUomId: box.id }),
    ).rejects.toThrow(/admin\.catalog\.baseUomImmutableWithTransactions/)
    await expect(deleteProduct(owner, prod1.product.id)).rejects.toThrow(/admin\.catalog\.productInUse/)

    // Delete unused prod2 succeeds; referenced UOM cannot be deleted until unused
    await expect(deleteUom(owner, box.id)).rejects.toThrow(/admin\.catalog\.uomInUse/)
    await deleteProduct(owner, prod2.product.id)
    await deleteUom(owner, box.id)

    // Manager scoped to Outlet A may manage tenant-wide master data but cannot mutate Outlet B availability
    const managerA: CatalogActor = {
      tenantId: owner.tenantId,
      appUserId: owner.appUserId,
      permissions: new Set(['catalog.manage']),
      outletIds: [outletA.id],
    }

    const mgrCategory = await createCategory(managerA, { name: 'Scoped Manager Category' })
    expect(mgrCategory.name).toBe('Scoped Manager Category')
    const mgrProduct = await createProduct(managerA, {
      categoryId: catL2.id,
      code: 'MGR-OK',
      name: 'Scoped Manager Product',
      baseUomId: pcs.id,
    })
    expect(mgrProduct.product.code).toBe('MGR-OK')

    // Deactivating a product is audited as catalog.changed
    await updateProduct(managerA, { id: mgrProduct.product.id, isActive: false })
    const catalogAudits = (await listAuditActions(owner.tenantId)).filter(
      (a) => a.action === 'catalog.changed' && a.entity_type === 'product',
    )
    expect(catalogAudits).toHaveLength(1)
    expect(catalogAudits[0]?.entity_id).toBe(mgrProduct.product.id)

    // A view-only actor can read but not write; an actor without catalog permissions cannot read
    const viewer: CatalogActor = { ...managerA, permissions: new Set(['catalog.view']) }
    expect((await listCategories(viewer)).length).toBeGreaterThan(0)
    await expect(createCategory(viewer, { name: 'Viewer Blocked' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const nobody: CatalogActor = { ...managerA, permissions: new Set<string>() }
    await expect(listCategories(nobody)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      setProductAvailability(managerA, {
        outletId: outletB.id,
        productId: prod1.product.id,
        status: 'UNAVAILABLE',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const updatedAvail = await setProductAvailability(managerA, {
      outletId: outletA.id,
      productId: prod1.product.id,
      status: 'UNAVAILABLE',
      reasonText: 'Out of stock at Outlet A',
    })
    expect(updatedAvail.status).toBe('UNAVAILABLE')

    // Ensure AppError class intact
    expect(new AppError('FORBIDDEN', 'test').code).toBe('FORBIDDEN')
  })
})
