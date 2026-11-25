import { expect, test } from '@playwright/test'
import { eq, sql } from 'drizzle-orm'
import { bill } from '../../src/modules/fnb/public'
import { withTenant } from '../../src/server/db'
import { pairDeviceViaUi } from './helpers/device'
import { loginStaffPin, openShiftUi, waitOutboxAllAcked } from './helpers/pos'
import {
  createF5Tenant,
  F5_CASHIER_NAME,
  F5_CASHIER_PIN,
  f5PairingCodeFor,
} from './helpers/seed-f5'

test.use({ locale: 'id-ID' })

test.describe('F5-L05 merge bills & equal split -> 3 paid shares + parent CLOSED_BY_SPLIT', () => {
  test('f5-split-merge: merge M05 into M06, split M06 equal 3 ways, pay all 3 shares -> parent CLOSED_BY_SPLIT', async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const t = await createF5Tenant('f5sm')
    const cCode = await f5PairingCodeFor(t, t.cashierRegId)

    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    await pairDeviceViaUi(page, t.slug, cCode, 'Kasir SplitMerge')
    await loginStaffPin(page, F5_CASHIER_NAME, F5_CASHIER_PIN)
    await openShiftUi(page, 500_000)

    await page.getByRole('navigation', { name: 'Navigasi Kasir' }).first().getByRole('link', { name: 'Meja' }).click()
    await expect(page).toHaveURL(/\/pos\/tables/, { timeout: 15_000 })

    const catalog = page.getByRole('region', { name: 'Katalog produk' })

    // Open M05 and add Es Teh
    await page.getByRole('button', { name: /M05/ }).click()
    await page.getByRole('button', { name: 'Buka bill baru di meja ini' }).click()
    await catalog.getByRole('button', { name: /Es Teh/ }).click()
    await page.getByRole('button', { name: 'Kembali ke Meja' }).click()

    // Open M06 and add Nasi Goreng (no modifier)
    await page.getByRole('button', { name: /M06/ }).click()
    await page.getByRole('button', { name: 'Buka bill baru di meja ini' }).click()
    await catalog.getByRole('button', { name: /Nasi Goreng/ }).click()
    await page.getByRole('button', { name: 'Tambah ke bill' }).click()

    // Merge M05 into M06
    await page.getByRole('button', { name: 'Gabung', exact: true }).click()
    await expect(page).toHaveURL(/\/merge$/, { timeout: 10_000 })
    await page.getByRole('checkbox').first().check()
    await page.getByRole('button', { name: 'Konfirmasi Gabung Bill' }).click()
    await expect(page).toHaveURL(/\/pos\/bill\/[^/]+$/, { timeout: 15_000 })

    // Split M06 equal 3 ways
    await page.getByRole('button', { name: 'Pisah', exact: true }).click()
    await expect(page).toHaveURL(/\/split$/, { timeout: 10_000 })
    await page.getByRole('button', { name: 'Tambah jumlah bill' }).click()
    await page.getByRole('button', { name: 'Konfirmasi Pisah Bill' }).click()
    await expect(page).toHaveURL(/\/pos\/bill\/[^/]+$/, { timeout: 15_000 })
    await expect(page.getByText('Bagian 1/3')).toBeVisible()

    // Pay all 3 equal shares sequentially via table grid (2 shares -> picker dialog; last share -> direct open)
    for (let i = 1; i <= 3; i += 1) {
      if (i > 1) {
        await page.getByRole('navigation', { name: 'Navigasi Kasir' }).first().getByRole('link', { name: 'Meja' }).click()
        await page.getByRole('button', { name: /M06/ }).click()
        const dialog = page.locator('[role="dialog"]')
        if ((await dialog.count()) > 0) {
          await dialog.getByRole('button', { name: /M06/ }).first().click()
        }
      }
      await page.getByRole('button', { name: 'Bayar', exact: true }).click()
      await expect(page).toHaveURL(/\/pos\/pay\?billId=/, { timeout: 10_000 })
      await page.getByRole('button', { name: 'Tunai', exact: true }).click()
      await page.getByRole('button', { name: 'Tambah metode', exact: true }).click()
      await page.getByRole('button', { name: 'Selesai', exact: true }).click()
      await expect(page).toHaveURL(/\/pos\/done\//, { timeout: 20_000 })
    }

    await waitOutboxAllAcked(page, 60_000)

    await withTenant(t.tenantId, async (tx) => {
      const bills = await tx.select().from(bill).where(eq(bill.tenantId, t.tenantId))
      const merged = bills.filter((b) => b.status === 'MERGED')
      const closedParent = bills.filter((b) => b.status === 'CLOSED_BY_SPLIT')
      const paid = bills.filter((b) => b.status === 'PAID')
      expect(merged).toHaveLength(1)
      expect(closedParent).toHaveLength(1)
      expect(paid).toHaveLength(3)

      const stockBasisCnt = await tx.execute<{ cnt: string }>(
        sql`SELECT count(*)::text AS cnt FROM sale_line WHERE tenant_id = ${t.tenantId} AND line_kind = 'STOCK_BASIS'`,
      )
      expect(Number(stockBasisCnt.rows[0]!.cnt)).toBeGreaterThanOrEqual(1)
    })
  })
})
