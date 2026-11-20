import { expect, test } from '@playwright/test'
import { toMoney } from '../../src/lib/kernel'
import {
  addAttributeValue,
  createCategory,
  createProduct,
  createUom,
  setPrice,
  setProductAvailability,
  setSkuOverride,
  updateProduct,
} from '../../src/modules/catalog/public'
import { writeMaster } from '../../src/modules/sync/public'
import { withTenant } from '../../src/server/db'
import { sql } from 'drizzle-orm'
import { createThreeOutletE2eTenant } from '../../scripts/bench/seed-catalog'
import { pairDeviceViaUi } from './helpers/device'
import { createPairingCodeDirect, readTenantSyncState } from './helpers/server'

test.describe('F2-K05 outlet availability Bab 7.2.4 examples & atomic cycle apply', () => {
  test('F2-K05 enforces Contoh 1, V-27 (6/3/6 -> 8/5/8 -> 1 -> 0), and atomic multi-page cycle apply (EC-050)', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const tenant = await createThreeOutletE2eTenant('f2k05')
    const cat = await createCategory(tenant.actor, { name: 'Beverages & Apparel' })
    const pcs = await createUom(tenant.actor, { code: 'pcs', name: 'Pieces', allowFraction: false })

    // Contoh 1: Kopi Bubuk 200g (8999999000100)
    const kopi = await createProduct(tenant.actor, {
      categoryId: cat.id,
      code: 'KP-200',
      name: 'Kopi Bubuk 200g',
      productType: 'RETAIL',
      hasVariants: false,
      baseUomId: pcs.id,
      barcode: '8999999000100',
    })
    await setPrice(tenant.actor, {
      skuId: kopi.skus[0]!.id,
      uomId: pcs.id,
      outletId: null,
      price: toMoney(25000),
    })

    // Contoh 2 / V-27: Kaos Polos with 2 Colors x 3 Sizes = 6 SKUs
    const kaos = await createProduct(tenant.actor, {
      categoryId: cat.id,
      code: 'KAOS',
      name: 'Kaos Polos',
      productType: 'RETAIL',
      hasVariants: true,
      baseUomId: pcs.id,
      attributes: [
        { name: 'Size', values: ['S', 'M', 'L'] },
        { name: 'Color', values: ['HTM', 'PTH'] },
      ],
    })
    const sizeAttrId = kaos.attributes.find((a) => a.attribute.name === 'Size')!.attribute.id

    // Hide the 3 PTH SKUs at Outlet B -> visible Kaos SKUs A/B/C = 6 / 3 / 6
    const pthSkus = kaos.skus.filter((s) => s.skuCode.includes('PTH'))
    for (const s of pthSkus) {
      await setSkuOverride(tenant.actor, {
        outletId: tenant.outletBId,
        productId: kaos.product.id,
        skuId: s.id,
        status: 'UNAVAILABLE',
      })
    }

    const [codeA, codeB, codeC] = await Promise.all([
      createPairingCodeDirect(tenant.tenantId, tenant.registerAId, tenant.actorUserId),
      createPairingCodeDirect(tenant.tenantId, tenant.registerBId, tenant.actorUserId),
      createPairingCodeDirect(tenant.tenantId, tenant.registerCId, tenant.actorUserId),
    ])

    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const ctxC = await browser.newContext()
    try {
      const [pageA, pageB, pageC] = await Promise.all([
        ctxA.newPage(),
        ctxB.newPage(),
        ctxC.newPage(),
      ])
      await pairDeviceViaUi(pageA, tenant.slug, codeA, 'Dev OUT01')
      await pairDeviceViaUi(pageB, tenant.slug, codeB, 'Dev OUT02')
      await pairDeviceViaUi(pageC, tenant.slug, codeC, 'Dev OUT03')

      // Initial counts: 1 Kopi + 6 Kaos = 7 (A), 1 + 3 = 4 (B), 1 + 6 = 7 (C)
      await Promise.all([
        expect
          .poll(() => pageA.evaluate(() => window.__solva!.catalog.visibleCount()), { timeout: 20_000 })
          .toBe(7),
        expect
          .poll(() => pageB.evaluate(() => window.__solva!.catalog.visibleCount()), { timeout: 20_000 })
          .toBe(4),
        expect
          .poll(() => pageC.evaluate(() => window.__solva!.catalog.visibleCount()), { timeout: 20_000 })
          .toBe(7),
      ])

      // Contoh 1: Mark Kopi UNAVAILABLE at Outlet C -> single version bump; hidden & distinct scan message
      const vBefore = (await readTenantSyncState(tenant.tenantId)).version
      await setProductAvailability(tenant.actor, {
        outletId: tenant.outletCId,
        productId: kopi.product.id,
        status: 'UNAVAILABLE',
      })
      const vAfterKopi = (await readTenantSyncState(tenant.tenantId)).version
      expect(vAfterKopi).toBe(vBefore + 1)

      await expect
        .poll(
          async () => {
            await pageC.evaluate(() => window.__solva!.kickSync())
            return pageC.evaluate(() => window.__solva!.catalog.visibleCount())
          },
          { timeout: 15_000, intervals: [500] },
        )
        .toBe(6)

      const kopiAtC = await pageC.evaluate(async () => ({
        search: await window.__solva!.catalog.searchProducts('Kopi'),
        scan: await window.__solva!.catalog.resolveScan('8999999000100'),
      }))
      expect(kopiAtC.search).toEqual([])
      expect(kopiAtC.scan).toEqual({
        kind: 'UNAVAILABLE_AT_OUTLET',
        productName: 'Kopi Bubuk 200g',
      })

      // V-27 step 2: Add size XL (+2 SKUs: XL-HTM, XL-PTH) -> default AVAILABLE at all outlets -> 8 / 5 / 8
      await addAttributeValue(tenant.actor, {
        productId: kaos.product.id,
        attributeId: sizeAttrId,
        value: 'XL',
      })

      const kaosCount = async (p: typeof pageA) =>
        p.evaluate(async () => {
          const hits = await window.__solva!.catalog.searchProducts('Kaos Polos')
          return hits[0]?.skus.length ?? 0
        })

      await Promise.all([
        expect
          .poll(async () => {
            await pageA.evaluate(() => window.__solva!.kickSync())
            return kaosCount(pageA)
          }, { timeout: 15_000, intervals: [500] })
          .toBe(8),
        expect
          .poll(async () => {
            await pageB.evaluate(() => window.__solva!.kickSync())
            return kaosCount(pageB)
          }, { timeout: 15_000, intervals: [500] })
          .toBe(5),
        expect
          .poll(async () => {
            await pageC.evaluate(() => window.__solva!.kickSync())
            return kaosCount(pageC)
          }, { timeout: 15_000, intervals: [500] })
          .toBe(8),
      ])

      // Contoh 5: Parent UNAVAILABLE at Outlet C + L-HTM override AVAILABLE -> only 1 Kaos SKU visible at C
      const lHtm = kaos.skus.find((s) => s.skuCode.includes('L') && s.skuCode.includes('HTM'))!
      await setProductAvailability(tenant.actor, {
        outletId: tenant.outletCId,
        productId: kaos.product.id,
        status: 'UNAVAILABLE',
      })
      await setSkuOverride(tenant.actor, {
        outletId: tenant.outletCId,
        productId: kaos.product.id,
        skuId: lHtm.id,
        status: 'AVAILABLE',
      })

      await expect
        .poll(async () => {
          await pageC.evaluate(() => window.__solva!.kickSync())
          return kaosCount(pageC)
        }, { timeout: 15_000, intervals: [500] })
        .toBe(1)

      // Global inactive beats everything -> 0 SKUs across all outlets
      await updateProduct(tenant.actor, { id: kaos.product.id, isActive: false })
      await Promise.all([
        expect
          .poll(async () => {
            await pageA.evaluate(() => window.__solva!.kickSync())
            return kaosCount(pageA)
          }, { timeout: 15_000, intervals: [500] })
          .toBe(0),
        expect
          .poll(async () => {
            await pageB.evaluate(() => window.__solva!.kickSync())
            return kaosCount(pageB)
          }, { timeout: 15_000, intervals: [500] })
          .toBe(0),
        expect
          .poll(async () => {
            await pageC.evaluate(() => window.__solva!.kickSync())
            return kaosCount(pageC)
          }, { timeout: 15_000, intervals: [500] })
          .toBe(0),
      ])

      // EC-050 Atomic cycle apply: insert 650 new products + 650 SKUs (> 2 pull pages of 500),
      // hold the last pull page on Device A, assert zero intermediate visibility change, then release.
      const beforeAtomicCount = await pageA.evaluate(() => window.__solva!.catalog.visibleCount())
      expect(beforeAtomicCount).toBe(1) // Only Kopi at OUT01

      await withTenant(tenant.tenantId, async (tx) => {
        await writeMaster(tx, { actorUserId: tenant.actorUserId }, async (w) => {
          const ts = new Date().toISOString()
          await tx.execute(sql`
            WITH prods AS (
              INSERT INTO product (id, tenant_id, version, created_at, updated_at, created_by, updated_by, category_id, code, name, product_type, has_variants, base_uom_id, sort_order)
              SELECT uuidv7(), ${w.tenantId}::uuid, ${w.version}::bigint, ${ts}::timestamptz, ${ts}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${cat.id}::uuid, 'AT-' || g::text, 'Atomic Item ' || g::text, 'RETAIL', false, ${pcs.id}::uuid, g
              FROM generate_series(1, 650) AS g
              RETURNING id, code
            )
            INSERT INTO sku (id, tenant_id, version, created_at, updated_at, created_by, updated_by, product_id, sku_code, variant_label, is_default, is_active, sort_order)
            SELECT uuidv7(), ${w.tenantId}::uuid, ${w.version}::bigint, ${ts}::timestamptz, ${ts}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, id, code, NULL, true, true, 0
            FROM prods
          `)
        })
      })

      let holdActive = true
      let pageInterceptCount = 0
      let releaseFinalPage: (() => void) | null = null
      let sawHeldPage = false
      const routeDonePromises: Promise<void>[] = []

      const routeHandler = async (route: import('@playwright/test').Route) => {
        if (!holdActive || route.request().url().includes('/full/')) {
          await route.continue()
          return
        }
        pageInterceptCount += 1
        if (pageInterceptCount === 2) {
          sawHeldPage = true
          await new Promise<void>((resolve) => {
            releaseFinalPage = resolve
          })
          holdActive = false
        }
        await route.continue()
      }

      await pageA.route('**/api/pos/v1/pull', async (route) => {
        const p = routeHandler(route).catch(() => {})
        routeDonePromises.push(p)
        await p
      })

      await pageA.evaluate(() => window.__solva!.kickSync())
      await expect.poll(() => sawHeldPage, { timeout: 15_000 }).toBe(true)

      // While page 2+ is held, page 1's 500 staged rows MUST NOT be visible yet!
      await pageA.waitForTimeout(300)
      expect(await pageA.evaluate(() => window.__solva!.catalog.visibleCount())).toBe(beforeAtomicCount)

      releaseFinalPage!()
      await Promise.all(routeDonePromises)

      await expect
        .poll(() => pageA.evaluate(() => window.__solva!.catalog.visibleCount()), { timeout: 25_000 })
        .toBe(beforeAtomicCount + 650)
      await pageA.unroute('**/api/pos/v1/pull')
    } finally {
      await ctxA.close()
      await ctxB.close()
      await ctxC.close()
    }
  })
})
