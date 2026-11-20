import { webcrypto } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import {
  FULL_RESYNC_ENTITY_ORDER,
  fullResyncPage,
  pullPage,
  startFullResync,
  startPullCycle,
  type FeedCursor,
  type SyncDeviceIdentity,
} from '~/modules/sync/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-pull-conc@example.test' }

async function setupConcurrencyFixture(prefix: string) {
  const slug = uniqueSlug(prefix)
  const created = await createTenant(testOp, {
    name: `Conc ${slug}`,
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

  const le = await createLegalEntity(idActor, { name: 'PT Concurrent', isPkp: false })
  const out1 = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 1',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const out2 = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUT02',
    name: 'Outlet 2',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })

  async function enroll(outletId: string, code: string): Promise<SyncDeviceIdentity> {
    const reg = await createRegister(idActor, {
      outletId,
      code,
      name: `Reg ${code}`,
      registerType: 'CASHIER',
      invoicePrefix: code,
    })
    const pair = await createPairingCode(idActor, reg.id)
    const enr = await enrollDevice({ slug, code: pair.code, device_name: `Dev ${code}` }, '10.9.1.1', {
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

  return {
    tenantId: created.tenantId,
    catActor,
    out1,
    out2,
    dev1: await enroll(out1.id, 'P1'),
    dev2: await enroll(out1.id, 'P2'),
    dev3: await enroll(out2.id, 'P3'),
  }
}

async function applyIncrementalCycle(
  device: SyncDeviceIdentity,
  cursor: FeedCursor | null,
  state: Map<string, Map<string, Record<string, unknown>>>,
): Promise<{ cursor: FeedCursor | null; upper: number }> {
  const scope = {
    tenantId: device.tenantId,
    outletId: device.outletId,
    registerId: device.registerId,
    deviceId: device.deviceId,
  }
  const cycle = await startPullCycle(device.tenantId)
  let cur = cursor
  while (true) {
    const res = await pullPage({
      tenantId: device.tenantId,
      scope,
      cursor: cur,
      cycleUpper: cycle.upper,
      pageSize: 15,
    })
    if (res.fullResyncRequired) throw new Error('unexpected full resync')
    for (const row of res.rows) {
      let bucket = state.get(row.entity)
      if (!bucket) {
        bucket = new Map()
        state.set(row.entity, bucket)
      }
      if (row.op === 'delete') {
        bucket.delete(row.id)
      } else if (row.row) {
        bucket.set(row.id, row.row)
      }
    }
    cur = res.nextCursor
    if (!res.hasMore) break
  }
  return { cursor: cur, upper: cycle.upper }
}

describe('pull-catalog-concurrency (6 concurrent writers + 3 polling devices converge)', () => {
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

  it('loses zero rows across 6 parallel catalog/price/availability writers and 3 active polling devices', { timeout: 60_000 }, async () => {
    const fx = await setupConcurrencyFixture('pconc')
    const cat = await createCategory(fx.catActor, { name: 'ConcCat' })
    const pcs = await createUom(fx.catActor, { code: 'pcs', name: 'Pieces' })
    const seedProd = await createProduct(fx.catActor, {
      categoryId: cat.id,
      code: 'BASE-1',
      name: 'Base Item',
      baseUomId: pcs.id,
    })
    const seedSku = seedProd.skus[0]!

    const stateDev1 = new Map<string, Map<string, Record<string, unknown>>>()
    const stateDev2 = new Map<string, Map<string, Record<string, unknown>>>()
    const stateDev3 = new Map<string, Map<string, Record<string, unknown>>>()

    let writersDone = false
    const writerTasks = [
      // Writer 1: create 8 new products sequentially
      (async () => {
        for (let i = 0; i < 8; i += 1) {
          await createProduct(fx.catActor, {
            categoryId: cat.id,
            code: `W1-${i}`,
            name: `Writer Product ${i}`,
            baseUomId: pcs.id,
          })
        }
      })(),
      // Writer 2: mutate OUT01 default/override prices repeatedly
      (async () => {
        for (let i = 1; i <= 10; i += 1) {
          await setPrice(fx.catActor, {
            skuId: seedSku.id,
            uomId: pcs.id,
            outletId: fx.out1.id,
            price: 10000 + i * 500,
          })
        }
      })(),
      // Writer 3: mutate OUT02 prices and clear once mid-run
      (async () => {
        for (let i = 1; i <= 6; i += 1) {
          await setPrice(fx.catActor, {
            skuId: seedSku.id,
            uomId: pcs.id,
            outletId: fx.out2.id,
            price: 20000 + i * 500,
          })
          if (i === 3) {
            await clearOutletPrice(fx.catActor, {
              skuId: seedSku.id,
              uomId: pcs.id,
              outletId: fx.out2.id,
            })
          }
        }
      })(),
      // Writer 4: toggle OUT01 availability repeatedly
      (async () => {
        for (let i = 0; i < 10; i += 1) {
          await setProductAvailability(fx.catActor, {
            outletId: fx.out1.id,
            productId: seedProd.product.id,
            status: i % 2 === 0 ? 'UNAVAILABLE' : 'AVAILABLE',
          })
        }
      })(),
      // Writer 5: toggle OUT02 availability repeatedly
      (async () => {
        for (let i = 0; i < 10; i += 1) {
          await setProductAvailability(fx.catActor, {
            outletId: fx.out2.id,
            productId: seedProd.product.id,
            status: i % 2 === 0 ? 'AVAILABLE' : 'UNAVAILABLE',
          })
        }
      })(),
      // Writer 6: create extra variant products
      (async () => {
        for (let i = 0; i < 5; i += 1) {
          await createProduct(fx.catActor, {
            categoryId: cat.id,
            code: `W6-${i}`,
            name: `Variant Product ${i}`,
            hasVariants: true,
            baseUomId: pcs.id,
            attributes: [{ name: 'Size', values: ['S', 'L'] }],
          })
        }
      })(),
    ]

    const runWriters = Promise.all(writerTasks).finally(() => {
      writersDone = true
    })

    async function pollLoop(
      dev: SyncDeviceIdentity,
      state: Map<string, Map<string, Record<string, unknown>>>,
    ): Promise<FeedCursor | null> {
      let cursor: FeedCursor | null = null
      while (!writersDone) {
        const res = await applyIncrementalCycle(dev, cursor, state)
        cursor = res.cursor
      }
      // Final drain after all writers complete
      const finalRes = await applyIncrementalCycle(dev, cursor, state)
      return finalRes.cursor
    }

    const [, cursor1, cursor2, cursor3] = await Promise.all([
      runWriters,
      pollLoop(fx.dev1, stateDev1),
      pollLoop(fx.dev2, stateDev2),
      pollLoop(fx.dev3, stateDev3),
    ])

    // Perform full resync on each device and compare materialized live state
    async function snapshotDevice(dev: SyncDeviceIdentity) {
      const fs = await startFullResync(
        dev,
        {},
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `fs-${dev.registerId}` },
      )
      const map = new Map<string, Map<string, Record<string, unknown>>>()
      for (const entity of FULL_RESYNC_ENTITY_ORDER) {
        const bucket = new Map<string, Record<string, unknown>>()
        let afterId: string | null = null
        while (true) {
          const p = await fullResyncPage(dev, {
            snapshot_token: fs.snapshot_token,
            entity,
            after_id: afterId,
            page_size: 100,
          })
          for (const row of p.rows) {
            if (row.row) bucket.set(row.id, row.row)
          }
          if (!p.has_more) break
          afterId = p.next_after_id
        }
        map.set(entity, bucket)
      }
      return map
    }

    // Drain any last tail in case fullResync saw identical snapshot version
    await applyIncrementalCycle(fx.dev1, cursor1, stateDev1)
    await applyIncrementalCycle(fx.dev2, cursor2, stateDev2)
    await applyIncrementalCycle(fx.dev3, cursor3, stateDev3)

    const snap1 = await snapshotDevice(fx.dev1)
    const snap2 = await snapshotDevice(fx.dev2)
    const snap3 = await snapshotDevice(fx.dev3)

    const checkedEntities = [
      'category',
      'uom',
      'product',
      'sku',
      'sku_uom',
      'item_outlet_availability',
      'price_entry',
    ] as const

    for (const [label, incState, snapState] of [
      ['dev1', stateDev1, snap1],
      ['dev2', stateDev2, snap2],
      ['dev3', stateDev3, snap3],
    ] as const) {
      for (const entity of checkedEntities) {
        const incBucket = incState.get(entity) ?? new Map()
        const snapBucket = snapState.get(entity) ?? new Map()
        expect(
          Array.from(incBucket.keys()).sort(),
          `${label} incremental ${entity} keys diverged from snapshot`,
        ).toEqual(Array.from(snapBucket.keys()).sort())
      }
    }

    // Verify expected total catalog count (1 seed + 8 W1 + 5 W6 = 14 products; 1 + 8 + 10 = 19 SKUs)
    expect((stateDev1.get('product') ?? new Map()).size).toBe(14)
    expect((stateDev1.get('sku') ?? new Map()).size).toBe(19)
    // Dev1/Dev2 get only OUT01 availability (14 rows), Dev3 gets only OUT02 availability (14 rows)
    expect((stateDev1.get('item_outlet_availability') ?? new Map()).size).toBe(14)
    expect((stateDev3.get('item_outlet_availability') ?? new Map()).size).toBe(14)
  })
})
