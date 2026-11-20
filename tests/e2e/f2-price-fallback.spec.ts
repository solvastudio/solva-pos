import { expect, test } from '@playwright/test'
import { toMoney } from '../../src/lib/kernel'
import {
  addSkuUom,
  createCategory,
  createProduct,
  createUom,
  setPrice,
} from '../../src/modules/catalog/public'
import { createThreeOutletE2eTenant } from '../../scripts/bench/seed-catalog'
import { pairDeviceViaUi } from './helpers/device'
import { createPairingCodeDirect } from './helpers/server'

test.describe('F2-K04 offline price fallback and independent derived UOM pricing', () => {
  test('F2-K04 resolves outlet -> default -> NO_PRICE, OPEN_PRICE, and Susu pcs/dus distinct prices', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const tenant = await createThreeOutletE2eTenant('f2k04')
    const cat = await createCategory(tenant.actor, { name: 'Dairy & Staples' })
    const pcs = await createUom(tenant.actor, { code: 'pcs', name: 'Pieces', allowFraction: false })
    const dus = await createUom(tenant.actor, { code: 'dus', name: 'Dus', allowFraction: false })

    // 1. SKU with explicit outlet price (17,500) overriding tenant default (15,000)
    const p1 = await createProduct(tenant.actor, {
      categoryId: cat.id,
      code: 'F2-OUTLET',
      name: 'Outlet Priced Item',
      productType: 'RETAIL',
      hasVariants: false,
      baseUomId: pcs.id,
      barcode: '8994000000001',
    })
    await setPrice(tenant.actor, { skuId: p1.skus[0]!.id, uomId: pcs.id, outletId: null, price: toMoney(15000) })
    await setPrice(tenant.actor, {
      skuId: p1.skus[0]!.id,
      uomId: pcs.id,
      outletId: tenant.outletAId,
      price: toMoney(17500),
    })

    // 2. SKU with only tenant default price (12,000)
    const p2 = await createProduct(tenant.actor, {
      categoryId: cat.id,
      code: 'F2-DEFAULT',
      name: 'Default Priced Item',
      productType: 'RETAIL',
      hasVariants: false,
      baseUomId: pcs.id,
      barcode: '8994000000002',
    })
    await setPrice(tenant.actor, { skuId: p2.skus[0]!.id, uomId: pcs.id, outletId: null, price: toMoney(12000) })

    // 3. SKU with NO price -> blocked
    await createProduct(tenant.actor, {
      categoryId: cat.id,
      code: 'F2-UNPRICED',
      name: 'Unpriced Item',
      productType: 'RETAIL',
      hasVariants: false,
      baseUomId: pcs.id,
      barcode: '8994000000003',
    })

    // 4. Open-price item without master price -> OPEN_PRICE
    await createProduct(tenant.actor, {
      categoryId: cat.id,
      code: 'F2-OPEN',
      name: 'Custom Juice',
      productType: 'MENU_FNB',
      hasVariants: false,
      baseUomId: pcs.id,
      isOpenPrice: true,
      barcode: '8994000000004',
    })

    // 5. Susu UHT pcs 11,500 & dus (factor 12) 130,000 — independent of factor multiplication
    const pSusu = await createProduct(tenant.actor, {
      categoryId: cat.id,
      code: 'SUSU-UHT',
      name: 'Susu UHT 1L',
      productType: 'RETAIL',
      hasVariants: false,
      baseUomId: pcs.id,
      barcode: '8994000000011',
    })
    await addSkuUom(tenant.actor, {
      skuId: pSusu.skus[0]!.id,
      uomId: dus.id,
      conversionFactor: '12',
      barcode: '8994000000012',
    })
    await setPrice(tenant.actor, {
      skuId: pSusu.skus[0]!.id,
      uomId: pcs.id,
      outletId: null,
      price: toMoney(11500),
    })
    await setPrice(tenant.actor, {
      skuId: pSusu.skus[0]!.id,
      uomId: dus.id,
      outletId: null,
      price: toMoney(130000),
    })

    const code = await createPairingCodeDirect(
      tenant.tenantId,
      tenant.registerAId,
      tenant.actorUserId,
    )

    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await pairDeviceViaUi(page, tenant.slug, code, 'E2E Cashier K04')

      await expect
        .poll(() => page.evaluate(() => window.__solva!.catalog.count()), { timeout: 20_000 })
        .toBe(5)

      const scans = await page.evaluate(async () => {
        return {
          outlet: await window.__solva!.catalog.resolveScan('8994000000001'),
          def: await window.__solva!.catalog.resolveScan('8994000000002'),
          none: await window.__solva!.catalog.resolveScan('8994000000003'),
          open: await window.__solva!.catalog.resolveScan('8994000000004'),
          susuPcs: await window.__solva!.catalog.resolveScan('8994000000011'),
          susuDus: await window.__solva!.catalog.resolveScan('8994000000012'),
        }
      })

      expect(scans.outlet).toMatchObject({
        kind: 'FOUND',
        price: { kind: 'PRICE', price: 17500, source: 'OUTLET' },
      })
      expect(scans.def).toMatchObject({
        kind: 'FOUND',
        price: { kind: 'PRICE', price: 12000, source: 'DEFAULT' },
      })
      expect(scans.none).toEqual({
        kind: 'NO_PRICE',
        productName: 'Unpriced Item',
      })
      expect(scans.open).toMatchObject({
        kind: 'FOUND',
        price: { kind: 'OPEN_PRICE', suggested: null },
      })
      expect(scans.susuPcs).toMatchObject({
        kind: 'FOUND',
        price: { kind: 'PRICE', price: 11500, source: 'DEFAULT' },
      })
      expect(scans.susuDus).toMatchObject({
        kind: 'FOUND',
        price: { kind: 'PRICE', price: 130000, source: 'DEFAULT' },
      })
    } finally {
      await ctx.close()
    }
  })
})
