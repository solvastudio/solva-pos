import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type FeatureFlagDefinition } from '~/lib/feature-flags'
import { createIdGenerator } from '~/lib/kernel'
import {
  type CatalogActor,
  clearOutletPrice,
  createCategory,
  createProduct,
  createUom,
  setPrice,
  setProductAvailability,
} from '~/modules/catalog/public'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  getTenantAuthMetadataBySlug,
  setFeatureFlag,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import {
  cleanTombstoneFloors,
  type FeedCursor,
  type FeedRow,
  FULL_RESYNC_ENTITY_ORDER,
  fullResyncPage,
  pullPage,
  startFullResync,
  startPullCycle,
  type SyncDeviceIdentity,
  writeMaster,
} from '~/modules/sync/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
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

const testOp = { platformUserId: testIdGen.newId(), email: 'op-pull-cat@example.test' }

const TEST_FLAG_REGISTRY: Readonly<Record<string, FeatureFlagDefinition>> = {
  'ui.pos.test_feature': {
    default: false,
    failMode: 'closed',
    description: 'Test feature flag for catalog feed tests',
  },
}

async function setupThreeOutletTenant(prefix: string) {
  const slug = uniqueSlug(prefix)
  const created = await createTenant(testOp, {
    name: `PullCat ${slug}`,
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
  const catActor: CatalogActor = {
    tenantId: created.tenantId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(['catalog.manage']),
    outletIds: null,
  }

  const le = await createLegalEntity(idActor, { name: 'PT Feed Catalog', isPkp: false })
  const outA = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 1',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const outB = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUT02',
    name: 'Outlet 2',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const outC = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUT03',
    name: 'Outlet 3',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })

  async function enrollOutletDevice(outletId: string, code: string, name: string): Promise<SyncDeviceIdentity> {
    const reg = await createRegister(idActor, {
      outletId,
      code,
      name,
      registerType: 'CASHIER',
      invoicePrefix: `${code}-INV`,
    })
    const pair = await createPairingCode(idActor, reg.id)
    const enr = await enrollDevice({ slug, code: pair.code, device_name: name }, '10.9.0.1', {
      minDelayMs: 0,
    })
    return {
      tenantId: created.tenantId,
      deviceId: enr.device_id,
      registerId: reg.id,
      outletId,
      registerType: 'CASHIER',
    }
  }

  const devA = await enrollOutletDevice(outA.id, 'PA01', 'Dev A')
  const devB = await enrollOutletDevice(outB.id, 'PB01', 'Dev B')
  const devC = await enrollOutletDevice(outC.id, 'PC01', 'Dev C')

  return {
    tenantId: created.tenantId,
    idActor,
    catActor,
    outA,
    outB,
    outC,
    devA,
    devB,
    devC,
  }
}

async function pullAllIncremental(
  device: SyncDeviceIdentity,
  cursor: FeedCursor | null = null,
  pageSize = 100,
) {
  const scope = {
    tenantId: device.tenantId,
    outletId: device.outletId,
    registerId: device.registerId,
    deviceId: device.deviceId,
  }
  const cycle = await startPullCycle(device.tenantId)
  const rows: FeedRow[] = []
  let cur = cursor
  while (true) {
    const page = await pullPage({
      tenantId: device.tenantId,
      scope,
      cursor: cur,
      cycleUpper: cycle.upper,
      pageSize,
    })
    if (page.fullResyncRequired) {
      throw new Error('Unexpected full resync required')
    }
    rows.push(...page.rows)
    cur = page.nextCursor
    if (!page.hasMore) break
  }
  return { upper: cycle.upper, cursor: cur, rows }
}

describe('pull-catalog integration (scoping, projections, BR-CAT, tombstones & purge)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
    __clearDeviceAuthCacheForTests()
    __clearTenantCacheForTests()
  })

  afterEach(() => {
    resetCompositionForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('scopes availability & prices by outlet, strips forbidden fields, drops server-only attribute tables, and preserves UNAVAILABLE rows', async () => {
    const fx = await setupThreeOutletTenant('pcat1')
    const cat = await createCategory(fx.catActor, { name: 'Beverages' })
    const pcs = await createUom(fx.catActor, { code: 'pcs', name: 'Pieces' })

    const kaos = await createProduct(fx.catActor, {
      categoryId: cat.id,
      code: 'KAOS',
      name: 'Kaos',
      hasVariants: true,
      baseUomId: pcs.id,
      attributes: [{ name: 'Size', values: ['S', 'M'] }],
    })
    const kopi = await createProduct(fx.catActor, {
      categoryId: cat.id,
      code: 'KOPI',
      name: 'Kopi Tubruk',
      baseUomId: pcs.id,
      excludeOutletIds: [fx.outC.id],
    })

    const kopiSku = kopi.skus[0]!
    const defPrice = await setPrice(fx.catActor, { skuId: kopiSku.id, uomId: pcs.id, price: 12000 })
    const priceOutA = await setPrice(fx.catActor, {
      skuId: kopiSku.id,
      uomId: pcs.id,
      outletId: fx.outA.id,
      price: 15000,
    })
    const priceOutB = await setPrice(fx.catActor, {
      skuId: kopiSku.id,
      uomId: pcs.id,
      outletId: fx.outB.id,
      price: 18000,
    })

    const flag = await setFeatureFlag(
      fx.idActor,
      { key: 'ui.pos.test_feature', enabled: true, note: 'internal note' },
      { registry: TEST_FLAG_REGISTRY },
    )

    // Pull for Device A (OUT01)
    const pullA = await pullAllIncremental(fx.devA)
    const byEntityA = new Map<string, FeedRow[]>()
    for (const r of pullA.rows) {
      const arr = byEntityA.get(r.entity) ?? []
      arr.push(r)
      byEntityA.set(r.entity, arr)
    }

    expect(byEntityA.get('product')?.map((r) => r.id)).toEqual(
      expect.arrayContaining([kaos.product.id, kopi.product.id]),
    )
    expect(byEntityA.get('sku')).toHaveLength(3)
    expect(byEntityA.get('sku_uom')).toHaveLength(3)
    expect(byEntityA.get('category')).toHaveLength(1)
    expect(byEntityA.get('uom')).toHaveLength(1)
    expect(byEntityA.get('feature_flag')?.map((r) => r.id)).toEqual([flag.id])

    // Server-only attribute tables never appear on wire
    expect(byEntityA.has('product_attribute')).toBe(false)
    expect(byEntityA.has('attribute_value')).toBe(false)
    expect(byEntityA.has('sku_attribute_value')).toBe(false)

    // Device A receives ONLY OUT01 availability
    const availA = byEntityA.get('item_outlet_availability') ?? []
    expect(availA).toHaveLength(2)
    expect(availA.every((r) => r.row?.outlet_id === fx.outA.id)).toBe(true)

    // Device A receives default price + OUT01 price, NEVER OUT02 price
    const pricesA = byEntityA.get('price_entry') ?? []
    expect(pricesA.map((r) => r.id).sort()).toEqual([defPrice.id, priceOutA.id].sort())
    expect(pricesA.some((r) => r.id === priceOutB.id)).toBe(false)

    // Projection strips tenant_id, created_at, updated_at, deleted_at, created_by, updated_by, changed_by, note
    for (const entity of ['product', 'sku', 'sku_uom', 'item_outlet_availability', 'price_entry', 'feature_flag']) {
      for (const r of byEntityA.get(entity) ?? []) {
        expect(r.row).toBeDefined()
        expect(r.row!.version).toBeTypeOf('number')
        expect(r.row!.tenant_id).toBeUndefined()
        expect(r.row!.created_at).toBeUndefined()
        expect(r.row!.updated_at).toBeUndefined()
        expect(r.row!.deleted_at).toBeUndefined()
        expect(r.row!.created_by).toBeUndefined()
        expect(r.row!.updated_by).toBeUndefined()
        if (entity === 'item_outlet_availability') {
          expect(r.row!.changed_by).toBeUndefined()
          expect(r.row!.changed_at).toBeTypeOf('string')
        }
        if (entity === 'feature_flag') {
          expect(r.row!.note).toBeUndefined()
        }
      }
    }

    // Example BR-CAT: Device C still receives Kopi product + Kopi availability row with UNAVAILABLE
    const pullC = await pullAllIncremental(fx.devC)
    const kopProductAtC = pullC.rows.find((r) => r.entity === 'product' && r.id === kopi.product.id)
    const kopAvailAtC = pullC.rows.find(
      (r) => r.entity === 'item_outlet_availability' && r.row?.product_id === kopi.product.id,
    )
    expect(kopProductAtC?.op).toBe('upsert')
    expect(kopAvailAtC?.row?.status).toBe('UNAVAILABLE')

    // BR-CAT-013 availability update carries server changed_at to device incremental feed
    const serverClock = '2026-11-20T09:15:30.000Z'
    const updatedAvail = await setProductAvailability(
      fx.catActor,
      { outletId: fx.outC.id, productId: kopi.product.id, status: 'AVAILABLE' },
      { nowIso: () => serverClock },
    )
    const tailC = await pullAllIncremental(fx.devC, pullC.cursor)
    const updatedRowC = tailC.rows.find(
      (r) => r.entity === 'item_outlet_availability' && r.id === updatedAvail.id,
    )
    expect(updatedRowC?.row?.status).toBe('AVAILABLE')
    expect(updatedRowC?.row?.changed_at).toBe(serverClock)

    // Tombstone price (clearOutletPrice) -> op: 'delete' in incremental pull, absent from full resync
    await clearOutletPrice(fx.catActor, {
      skuId: kopiSku.id,
      uomId: pcs.id,
      outletId: fx.outA.id,
    })
    const tailA = await pullAllIncremental(fx.devA, pullA.cursor)
    expect(
      tailA.rows.find((r) => r.entity === 'price_entry' && r.id === priceOutA.id),
    ).toMatchObject({ op: 'delete', id: priceOutA.id })

    const fsInit = await startFullResync(
      fx.devA,
      {},
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'fs-cat1' },
    )
    expect(fsInit.entities).toEqual([...FULL_RESYNC_ENTITY_ORDER])
    const fsPriceRows: FeedRow[] = []
    let afterId: string | null = null
    while (true) {
      const p = await fullResyncPage(fx.devA, {
        snapshot_token: fsInit.snapshot_token,
        entity: 'price_entry',
        after_id: afterId,
        page_size: 100,
      })
      fsPriceRows.push(...p.rows)
      if (!p.has_more) break
      afterId = p.next_after_id
    }
    expect(fsPriceRows.map((r) => r.id)).toEqual([defPrice.id])
  })

  it('keeps bulk 4,000-product import in one cycle version and freezes cycleUpper across concurrent mid-cycle writes', async () => {
    const fx = await setupThreeOutletTenant('pcatbulk')
    const cat = await createCategory(fx.catActor, { name: 'Bulk' })
    const pcs = await createUom(fx.catActor, { code: 'pcs', name: 'Pieces' })

    const beforeBulk = await pullAllIncremental(fx.devA)
    const nowIso = new Date().toISOString()

    // Single writeMaster inserting 4,000 products = 1 master version
    const bulkVersion = await withTenant(fx.tenantId, async (tx) => {
      const res = await writeMaster(tx, { actorUserId: fx.idActor.appUserId }, async (w) => {
        await tx.execute(sql`
          INSERT INTO product (
            id, tenant_id, version, created_at, updated_at, created_by, updated_by,
            category_id, code, name, product_type, has_variants, base_uom_id, sort_order
          )
          SELECT
            uuidv7(), ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz,
            ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${cat.id}::uuid,
            'B-' || g::text, 'Bulk ' || g::text, 'RETAIL', false, ${pcs.id}::uuid, g
          FROM generate_series(1, 4000) AS g
        `)
        return w.version
      })
      return res.version
    })

    // Start cycle with fixed upper BEFORE a concurrent late write
    const cycle = await startPullCycle(fx.tenantId)
    expect(cycle.upper).toBe(bulkVersion)

    const scopeA = {
      tenantId: fx.tenantId,
      outletId: fx.outA.id,
      registerId: fx.devA.registerId,
      deviceId: fx.devA.deviceId,
    }

    const firstPage = await pullPage({
      tenantId: fx.tenantId,
      scope: scopeA,
      cursor: beforeBulk.cursor,
      cycleUpper: cycle.upper,
      pageSize: 500,
    })
    if (firstPage.fullResyncRequired) throw new Error('unexpected full resync')
    expect(firstPage.hasMore).toBe(true)

    // Mid-cycle writer creates a new product at version = cycle.upper + 1
    const midCycleProd = await createProduct(fx.catActor, {
      categoryId: cat.id,
      code: 'LATE-1',
      name: 'Mid Cycle Product',
      baseUomId: pcs.id,
    })

    let cur = firstPage.nextCursor
    const collectedIds: string[] = firstPage.rows
      .filter((r) => r.entity === 'product')
      .map((r) => r.id)
    while (true) {
      const p = await pullPage({
        tenantId: fx.tenantId,
        scope: scopeA,
        cursor: cur,
        cycleUpper: cycle.upper,
        pageSize: 500,
      })
      if (p.fullResyncRequired) throw new Error('unexpected full resync')
      expect(p.upper).toBe(cycle.upper)
      collectedIds.push(...p.rows.filter((r) => r.entity === 'product').map((r) => r.id))
      cur = p.nextCursor
      if (!p.hasMore) break
    }

    // All 4,000 bulk products arrived in the single cycle; the mid-cycle write stayed deferred
    expect(collectedIds).toHaveLength(4000)
    expect(collectedIds).not.toContain(midCycleProd.product.id)

    // Next pull cycle receives the mid-cycle write cleanly
    const nextCyclePull = await pullAllIncremental(fx.devA, cur)
    expect(
      nextCyclePull.rows.some((r) => r.entity === 'product' && r.id === midCycleProd.product.id),
    ).toBe(true)
  })

  it('physically purges unreferenced tombstones <= floor while keeping newer tombstones, live rows, and referenced entities', async () => {
    const fx = await setupThreeOutletTenant('pcatpurge')
    const cat = await createCategory(fx.catActor, { name: 'PurgeCat' })
    const pcs = await createUom(fx.catActor, { code: 'pcs', name: 'Pieces' })
    const prod = await createProduct(fx.catActor, {
      categoryId: cat.id,
      code: 'PRG-1',
      name: 'Purgeable Ref',
      baseUomId: pcs.id,
    })
    const deletedProd = await createProduct(fx.catActor, {
      categoryId: cat.id,
      code: 'PRG-DEL',
      name: 'Referenced Deleted Product',
      baseUomId: pcs.id,
    })
    const sku = prod.skus[0]!

    const baseMs = Date.UTC(2026, 10, 1, 0, 0, 0)
    const oldTombstoneIso = new Date(baseMs).toISOString()
    const recentTombstoneIso = new Date(baseMs + 20 * 86_400_000).toISOString()
    const runSweepIso = new Date(baseMs + 31 * 86_400_000).toISOString()

    // Old (>30d at sweep) tombstones on price_entry, item_outlet_availability, feature_flag, and product
    const oldPrice = await setPrice(
      fx.catActor,
      { skuId: sku.id, uomId: pcs.id, outletId: fx.outA.id, price: 9000 },
      { nowIso: () => oldTombstoneIso },
    )
    await clearOutletPrice(
      fx.catActor,
      { skuId: sku.id, uomId: pcs.id, outletId: fx.outA.id },
      { nowIso: () => oldTombstoneIso },
    )

    const oldAvailId = testIdGen.newId()
    await withTenant(fx.tenantId, async (tx) => {
      await writeMaster(tx, { actorUserId: fx.idActor.appUserId }, async (w) => {
        await tx.execute(sql`
          INSERT INTO item_outlet_availability (
            id, tenant_id, version, created_at, updated_at, created_by, updated_by, deleted_at,
            outlet_id, product_id, sku_id, status, changed_at
          ) VALUES (
            ${oldAvailId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${oldTombstoneIso}::timestamptz,
            ${oldTombstoneIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid,
            ${oldTombstoneIso}::timestamptz, ${fx.outB.id}::uuid, ${prod.product.id}::uuid, ${sku.id}::uuid,
            'UNAVAILABLE', ${oldTombstoneIso}::timestamptz
          )
        `)
      })
    })

    await setFeatureFlag(
      fx.idActor,
      { key: 'ui.pos.test_feature', enabled: true },
      { registry: TEST_FLAG_REGISTRY, nowIso: () => oldTombstoneIso },
    )
    const oldFlagRes = await withTenant(fx.tenantId, async (tx) => {
      return writeMaster(tx, { actorUserId: fx.idActor.appUserId }, async (w) => {
        await tx.execute(sql`
          UPDATE feature_flag
          SET deleted_at = ${oldTombstoneIso}::timestamptz, version = ${w.version}, updated_at = ${oldTombstoneIso}::timestamptz
          WHERE tenant_id = ${w.tenantId}::uuid AND flag_key = 'ui.pos.test_feature'
        `)
        return w.version
      })
    })

    // Soft-delete referenced product at old timestamp (must NOT be physically deleted)
    const deletedProdRes = await withTenant(fx.tenantId, async (tx) => {
      return writeMaster(tx, { actorUserId: fx.idActor.appUserId }, async (w) => {
        await tx.execute(sql`
          UPDATE product
          SET deleted_at = ${oldTombstoneIso}::timestamptz, version = ${w.version}, updated_at = ${oldTombstoneIso}::timestamptz
          WHERE tenant_id = ${w.tenantId}::uuid AND id = ${deletedProd.product.id}::uuid
        `)
        return w.version
      })
    })

    // Newer tombstone (> floor when sweep runs at +31d) + live row (must NOT be purged)
    const recentPrice = await setPrice(
      fx.catActor,
      { skuId: sku.id, uomId: pcs.id, outletId: fx.outB.id, price: 11000 },
      { nowIso: () => recentTombstoneIso },
    )
    const liveDefPrice = await setPrice(
      fx.catActor,
      { skuId: sku.id, uomId: pcs.id, price: 10000 },
      { nowIso: () => recentTombstoneIso },
    )
    await clearOutletPrice(
      fx.catActor,
      { skuId: sku.id, uomId: pcs.id, outletId: fx.outB.id },
      { nowIso: () => recentTombstoneIso },
    )

    const sweep = await cleanTombstoneFloors({
      tenantIds: [fx.tenantId],
      nowIso: () => runSweepIso,
    })
    expect(sweep.floorsAdvanced).toBe(1)

    await withTenant(fx.tenantId, async (tx) => {
      const oldPriceCount = await tx.execute(
        sql`SELECT count(*)::int AS c FROM price_entry WHERE id = ${oldPrice.id}::uuid`,
      )
      const oldAvailCount = await tx.execute(
        sql`SELECT count(*)::int AS c FROM item_outlet_availability WHERE id = ${oldAvailId}::uuid`,
      )
      const oldFlagCount = await tx.execute(
        sql`SELECT count(*)::int AS c FROM feature_flag WHERE tenant_id = ${fx.tenantId}::uuid AND flag_key = 'ui.pos.test_feature'`,
      )
      const recentPriceCount = await tx.execute(
        sql`SELECT count(*)::int AS c FROM price_entry WHERE id = ${recentPrice.id}::uuid`,
      )
      const livePriceCount = await tx.execute(
        sql`SELECT count(*)::int AS c FROM price_entry WHERE id = ${liveDefPrice.id}::uuid`,
      )
      const prodCount = await tx.execute(
        sql`SELECT count(*)::int AS c FROM product WHERE id = ${deletedProd.product.id}::uuid`,
      )

      expect((oldPriceCount.rows[0] as { c: number }).c).toBe(0)
      expect((oldAvailCount.rows[0] as { c: number }).c).toBe(0)
      expect((oldFlagCount.rows[0] as { c: number }).c).toBe(0)
      expect((recentPriceCount.rows[0] as { c: number }).c).toBe(1)
      expect((livePriceCount.rows[0] as { c: number }).c).toBe(1)
      expect((prodCount.rows[0] as { c: number }).c).toBe(1)
    })

    // Device at cursor == floor still receives newer (> floor) tombstones via incremental pull
    expect(deletedProdRes.version).toBeGreaterThan(oldFlagRes.version)
    const floorPull = await pullAllIncremental(fx.devB, {
      version: deletedProdRes.version,
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    })
    expect(
      floorPull.rows.find((r) => r.entity === 'price_entry' && r.id === recentPrice.id),
    ).toMatchObject({ op: 'delete', id: recentPrice.id })
  })
})
