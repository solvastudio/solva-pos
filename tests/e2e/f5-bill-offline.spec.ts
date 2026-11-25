import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { withTenant } from '../../src/server/db'
import { pairDeviceViaUi } from './helpers/device'
import { loginStaffPin, navPos, selectVirtualPrinter, waitOutboxAllAcked } from './helpers/pos'
import { createF5Tenant, F5_WAITER_NAME, F5_WAITER_PIN, f5PairingCodeFor } from './helpers/seed-f5'

test.use({ locale: 'id-ID' })

test.describe('F5-K04 offline bill flow & prebill awaiting status', () => {
  test('f5-bill-offline: open table, add 3 items + modifier, void 1, prebill => Menunggu bayar, add item => Terisi, sync ACK without stock_movement', async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const t = await createF5Tenant('f5off')
    const code = await f5PairingCodeFor(t, t.waiterRegId)

    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await pairDeviceViaUi(page, t.slug, code, 'E2E Waiter Offline')
    await loginStaffPin(page, F5_WAITER_NAME, F5_WAITER_PIN)
    await expect(page).toHaveURL(/\/pos\/tables/, { timeout: 15_000 })
    await selectVirtualPrinter(page)

    await ctx.setOffline(true)

    await page.getByRole('button', { name: /M05/ }).click()
    await page.getByRole('button', { name: 'Buka bill baru di meja ini' }).click()
    await expect(page).toHaveURL(/\/pos\/bill\//, { timeout: 15_000 })

    // Add Nasi Goreng + Extra Sambal modifier
    await page.getByRole('button', { name: /Nasi Goreng/ }).click()
    await page.getByText('Extra Sambal').click()
    await page.getByRole('button', { name: 'Tambah ke bill' }).click()

    // Add Es Teh
    await page.getByRole('button', { name: /Es Teh/ }).click()

    // Add Ayam Bakar (without modifier)
    await page.getByRole('button', { name: /Ayam Bakar/ }).click()
    await page.getByRole('button', { name: 'Tambah ke bill' }).click()

    // Void Ayam Bakar with mandatory reason
    await page.getByRole('button', { name: /Void item Ayam Bakar/ }).click()
    await page.getByLabel('Alasan void (wajib)').fill('Tamu ganti pesanan')
    await page.getByRole('button', { name: 'Void item', exact: true }).click()

    // Print Pre-bill -> table M05 becomes "Menunggu bayar"
    await page.getByRole('button', { name: 'Pra-bill' }).click()
    await page.getByRole('button', { name: 'Kembali ke Meja' }).click()
    await expect(page.getByRole('button', { name: /M05/ })).toContainText('Menunggu bayar')

    // Re-open M05 and add another Es Teh -> status returns to "Terisi"
    await page.getByRole('button', { name: /M05/ }).click()
    await page.getByRole('button', { name: /Es Teh/ }).click()
    await page.getByRole('button', { name: 'Kembali ke Meja' }).click()
    await expect(page.getByRole('button', { name: /M05/ })).toContainText('Terisi')

    await ctx.setOffline(false)
    await waitOutboxAllAcked(page, 60_000)

    await withTenant(t.tenantId, async (tx) => {
      const evts = await tx.execute<{ bill_seq: number }>(
        sql`SELECT bill_seq FROM bill_event WHERE tenant_id = ${t.tenantId} ORDER BY bill_seq`,
      )
      expect(evts.rows.map((r) => Number(r.bill_seq))).toEqual([1, 2, 3, 4, 5, 6, 7])

      const moves = await tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM stock_movement WHERE tenant_id = ${t.tenantId}`,
      )
      expect(Number(moves.rows[0]!.n)).toBe(0)
    })
    void navPos
  })
})
