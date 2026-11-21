import { expect, test } from '@playwright/test'
import { pairDeviceViaUi } from './helpers/device'
import {
  loginStaffPin,
  openShiftUi,
  payAndFinish,
  readOutbox,
  readPrintJobs,
  scanBarcode,
  selectPrinterAdapter,
} from './helpers/pos'
import { F3_CASHIER_NAME, F3_CASHIER_PIN, F3_PRODUCTS, createF3Tenant, pairingCodeFor } from './helpers/seed-f3'

test.use({ locale: 'id-ID' })

test.describe('F3-K04 cetak tidak menggagalkan checkout', () => {
  test('F3-K04 jalur cetak gagal: penjualan tetap tersimpan, banner muncul, Cetak ulang berhasil setelah jalur diperbaiki', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const t = await createF3Tenant('f3k04')
    const code = await pairingCodeFor(t, t.reg1Id)
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    await pairDeviceViaUi(page, t.slug, code, 'E2E Kasir K04')
    await loginStaffPin(page, F3_CASHIER_NAME, F3_CASHIER_PIN)
    await page.waitForFunction(() => Boolean((window as { __solva?: unknown }).__solva), { timeout: 15_000 })
    await expect
      .poll(() => page.evaluate(() => window.__solva!.catalog.count()), { timeout: 20_000 })
      .toBe(3)
    await openShiftUi(page, 100_000)

    // WebUSB tidak tersedia di headless: cetak akan gagal.
    await selectPrinterAdapter(page, 'WebUSB')
    await scanBarcode(page, F3_PRODUCTS.kopi.barcode)
    await payAndFinish(page, [{ method: 'CASH', amount: 20_500 }])

    // Checkout selesai dan banner gagal cetak tampil; transaksi tetap tersimpan lokal.
    await expect(page.getByText('Struk gagal dicetak', { exact: false })).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => (await readPrintJobs(page)).some((j) => j.kind === 'RECEIPT' && j.status === 'FAILED'), {
        timeout: 30_000,
      })
      .toBe(true)
    const outbox = await readOutbox(page)
    expect(outbox.some((r) => r.type === 'FinalizeSale')).toBe(true)

    // Jalur diperbaiki ke cetak virtual, lalu cetak ulang job gagal dari daftar Pengaturan Perangkat.
    await selectPrinterAdapter(page, 'Virtual (Uji)', { retryFailed: true })
    await expect
      .poll(async () => (await readPrintJobs(page)).some((j) => j.kind === 'REPRINT' && j.status === 'DONE'), {
        timeout: 30_000,
      })
      .toBe(true)
  })
})
