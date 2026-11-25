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
  F5_WAITER_NAME,
  F5_WAITER_PIN,
  f5PairingCodeFor,
} from './helpers/seed-f5'

test.use({ locale: 'id-ID' })

test.describe('F5-K05 waiter handover -> cashier accept & pay', () => {
  test('f5-handover: blocks offline/pending handover, transfers lease on accept, cashier pays -> PAID & invoice issued', async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const t = await createF5Tenant('f5ho')
    const [wCode, cCode] = await Promise.all([
      f5PairingCodeFor(t, t.waiterRegId),
      f5PairingCodeFor(t, t.cashierRegId),
    ])

    const waiterCtx = await browser.newContext()
    const cashierCtx = await browser.newContext()
    const wPage = await waiterCtx.newPage()
    const cPage = await cashierCtx.newPage()

    await pairDeviceViaUi(wPage, t.slug, wCode, 'HP Waiter')
    await loginStaffPin(wPage, F5_WAITER_NAME, F5_WAITER_PIN)

    await pairDeviceViaUi(cPage, t.slug, cCode, 'Kasir POS01')
    await loginStaffPin(cPage, F5_CASHIER_NAME, F5_CASHIER_PIN)
    await openShiftUi(cPage, 500_000)

    // Waiter offline: handover button must be disabled with reason (EC-058)
    await waiterCtx.setOffline(true)
    await wPage.getByRole('button', { name: /M05/ }).click()
    await wPage.getByRole('button', { name: 'Buka bill baru di meja ini' }).click()
    await wPage.getByRole('region', { name: 'Katalog produk' }).getByRole('button', { name: /Es Teh/ }).click()
    await expect(wPage.getByText('Serah-terima membutuhkan internet')).toBeVisible()
    await expect(wPage.getByRole('button', { name: 'Serahkan ke kasir' })).toBeDisabled()

    // Online + wait for outbox ACK, then hand over to Kasir Utama
    await waiterCtx.setOffline(false)
    await waitOutboxAllAcked(wPage, 60_000)
    await expect(wPage.getByRole('button', { name: 'Serahkan ke kasir' })).toBeEnabled({
      timeout: 15_000,
    })
    await wPage.getByRole('button', { name: 'Serahkan ke kasir' }).click()
    await wPage.getByRole('button', { name: 'Konfirmasi Serahkan' }).click()

    // Cashier navigates to Bill -> sees Incoming Bills via SSE signal / pull -> Terima
    await cPage.getByRole('navigation', { name: 'Navigasi Kasir' }).first().getByRole('link', { name: 'Bill' }).click()
    await expect(cPage.getByRole('button', { name: 'Terima' }).first()).toBeVisible({ timeout: 15_000 })
    await cPage.getByRole('button', { name: 'Terima' }).first().click()
    await expect(cPage).toHaveURL(/\/pos\/bill\//, { timeout: 15_000 })

    // Waiter should become read-only once pull updates lease
    await wPage.evaluate(() => window.__solva?.kickSync())
    await expect(wPage.getByText(/Dipegang device lain/)).toBeVisible({ timeout: 15_000 })

    // Cashier pays cash -> invoice issued, bill PAID
    await cPage.getByRole('button', { name: 'Bayar', exact: true }).click()
    await expect(cPage).toHaveURL(/\/pos\/pay\?billId=/, { timeout: 10_000 })
    await cPage.getByRole('button', { name: 'Tunai', exact: true }).click()
    await cPage.getByRole('button', { name: 'Tambah metode', exact: true }).click()
    await cPage.getByRole('button', { name: 'Selesai', exact: true }).click()
    await expect(cPage).toHaveURL(/\/pos\/done\//, { timeout: 20_000 })

    await waitOutboxAllAcked(cPage, 60_000)
    await withTenant(t.tenantId, async (tx) => {
      const bills = await tx.select().from(bill).where(eq(bill.tenantId, t.tenantId))
      expect(bills[0]!.status).toBe('PAID')
      const sales = await tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM sale WHERE tenant_id = ${t.tenantId}`,
      )
      expect(Number(sales.rows[0]!.n)).toBe(1)
    })
  })
})
