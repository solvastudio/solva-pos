import { expect, test } from '@playwright/test'
import { createUom } from '../../src/modules/catalog/public'
import { createThreeOutletE2eTenant } from '../../scripts/bench/seed-catalog'
import { loginAdminUi } from './helpers/admin'
import { pairDeviceViaUi } from './helpers/device'
import {
  createPairingCodeDirect,
  getDistinctSkuVersionsAfter,
  readTenantSyncState,
} from './helpers/server'

test.describe('F2-K02 4,000-SKU CSV import commits atomically in 1 version and syncs cleanly', () => {
  test('F2-K02 imports 4,000 SKUs via admin UI with single version bump and full multi-page device sync', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const ownerPassword = 'SolvaE2eOwner#123!'
    const tenant = await createThreeOutletE2eTenant('f2k02', { ownerPassword })
    await createUom(tenant.actor, { code: 'pcs', name: 'Pieces', allowFraction: false })
    const code = await createPairingCodeDirect(
      tenant.tenantId,
      tenant.registerAId,
      tenant.actorUserId,
    )

    const adminCtx = await browser.newContext()
    const posCtx = await browser.newContext()
    try {
      const posPage = await posCtx.newPage()
      await pairDeviceViaUi(posPage, tenant.slug, code, 'E2E Cashier K02')

      // Ensure baseline sync completed before import.
      await expect
        .poll(() => posPage.evaluate(() => window.__solva!.getMeta('cursor')), { timeout: 15_000 })
        .not.toBeNull()

      const syncBefore = await readTenantSyncState(tenant.tenantId)

      let pullPagesSeen = 0
      posPage.on('response', (res) => {
        if (res.url().includes('/api/pos/v1/pull') && !res.url().includes('/full/') && res.status() === 200) {
          pullPagesSeen += 1
        }
      })

      // Owner logs into Back Office and imports 4,000 SKUs via CSV.
      const adminPage = await adminCtx.newPage()
      await loginAdminUi(adminPage, tenant.slug, tenant.ownerEmail, ownerPassword)
      await adminPage.goto(`/${tenant.slug}/admin/catalog/import`, { waitUntil: 'networkidle' })

      const csvLines = [
        'kategori,kode_produk,nama_produk,tipe,uom_dasar,kode_sku,label_varian,barcode,harga_default,pajak,lacak_stok,open_price,aktif',
      ]
      for (let i = 1; i <= 4000; i += 1) {
        csvLines.push(
          `Minuman,IMP-${String(i).padStart(4, '0')},Produk Impor ${i},RETAIL,pcs,IMP-${String(i).padStart(4, '0')},,89970${String(i).padStart(8, '0')},15000,Y,Y,N,Y`,
        )
      }

      await adminPage
        .locator('input[type="file"]')
        .setInputFiles({
          name: 'import-4000.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(csvLines.join('\n'), 'utf8'),
        })

      await adminPage.getByRole('button', { name: /Validate & preview|Validasi & pratinjau/i }).click()
      const applyBtn = adminPage.getByRole('button', { name: /Apply import|Terapkan impor/i }).first()
      await expect(applyBtn).toBeVisible({ timeout: 30_000 })
      await applyBtn.click()
      await adminPage
        .getByRole('dialog')
        .getByRole('button', { name: /Apply import|Terapkan impor/i })
        .click()

      await expect(
        adminPage.getByRole('heading', { name: /Import completed|Impor selesai/i }),
      ).toBeVisible({ timeout: 45_000 })

      // Verify single version bump in DB across all 4,000 new SKUs.
      const syncAfter = await readTenantSyncState(tenant.tenantId)
      expect(syncAfter.version).toBe(syncBefore.version + 1)

      const skuVersions = await getDistinctSkuVersionsAfter(tenant.tenantId, syncBefore.version)
      expect(skuVersions).toEqual([{ version: syncAfter.version, count: 4000 }])

      // Online device receives all 4,000 SKUs over 8+ pull pages (8 x 500) in a complete cycle.
      await posPage.evaluate(() => window.__solva!.kickSync())
      await expect
        .poll(() => posPage.evaluate(() => window.__solva!.catalog.count()), {
          timeout: 60_000,
          intervals: [1_000],
        })
        .toBe(4_000)

      expect(pullPagesSeen).toBeGreaterThanOrEqual(8)
    } finally {
      await adminCtx.close()
      await posCtx.close()
    }
  })
})
