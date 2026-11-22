import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { withTenant } from '../../src/server/db'
import { pairDeviceViaUi } from './helpers/device'
import {
  closeShiftUi,
  approveWithSupervisor,
  loginStaffPin,
  navPos,
  openShiftUi,
  payAndFinish,
  readOutbox,
  readPrintJobs,
  scanBarcode,
  startNewSale,
  selectVirtualPrinter,
  waitOutboxAllAcked,
} from './helpers/pos'
import {
  F3_CASHIER_NAME,
  F3_CASHIER_PIN,
  F3_PRODUCTS,
  F3_SUPERVISOR_NAME,
  F3_SUPERVISOR_PIN,
  createF3Tenant,
  pairingCodeFor,
} from './helpers/seed-f3'

test.use({ locale: 'id-ID' })

test.describe('F3-K01 skenario penuh offline', () => {
  test('F3-K01 login PIN, buka shift, 3 penjualan (tunai, QRIS, campuran), cetak, tutup shift offline; data tiba saat online', async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const t = await createF3Tenant('f3k01')
    const code = await pairingCodeFor(t, t.reg1Id)
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message, (e.stack ?? '').slice(0, 600)))
    page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE_ERR', m.text().slice(0, 500)) })

    await pairDeviceViaUi(page, t.slug, code, 'E2E Kasir K01')
    await loginStaffPin(page, F3_CASHIER_NAME, F3_CASHIER_PIN)
    await page.waitForFunction(() => Boolean((window as { __solva?: unknown }).__solva), { timeout: 15_000 })
    await expect
      .poll(() => page.evaluate(() => window.__solva!.catalog.count()), { timeout: 20_000 })
      .toBe(3)
    await openShiftUi(page, 500_000)
    await selectVirtualPrinter(page)

    // Offline from this point: every command must be held in the local outbox.
    await ctx.setOffline(true)

    // Sale 1: cash.
    await scanBarcode(page, F3_PRODUCTS.kopi.barcode)
    await payAndFinish(page, [{ method: 'CASH', amount: 21_000 }])

    // Sale 2: QRIS.
    await startNewSale(page)
    await scanBarcode(page, F3_PRODUCTS.teh.barcode)
    await payAndFinish(page, [{ method: 'QRIS', amount: 13_320 }])

    // Sale 3: mixed (cash + QRIS).
    await startNewSale(page)
    await scanBarcode(page, F3_PRODUCTS.kopi.barcode)
    await scanBarcode(page, F3_PRODUCTS.roti.barcode)
    await payAndFinish(page, [
      { method: 'QRIS', amount: 5_000 },
      { method: 'CASH', amount: 40_000 },
    ])

    // Print: each sale creates a receipt job that must finish (virtual adapter).
    await expect
      .poll(async () => (await readPrintJobs(page)).filter((j) => j.kind === 'RECEIPT' && j.status === 'DONE').length, {
        timeout: 30_000,
      })
      .toBe(3)

    // Partial return: 1 Kopi Hitam from sale 3 (two lines), approved by supervisor Sari.
    await navPos(page, 'Riwayat')
    await page.getByText(/OUT01-POS01-1126-000003/).first().click({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Retur Barang', exact: true }).click({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Jumlah retur +', exact: true }).first().click({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Proses Retur', exact: true }).click({ timeout: 15_000 })
    await approveWithSupervisor(page, F3_SUPERVISOR_NAME, F3_SUPERVISOR_PIN)
    await expect(page.getByText('Nota Kredit Diterbitkan')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Kembali ke Riwayat', exact: true }).click({ timeout: 10_000 }).catch(() => undefined)

    // Cash into the drawer: 20,500 (sale 1) + 32,200 (sale 3); the coffee return paid 20,500 in cash leaves the drawer.
    await closeShiftUi(page, 500_000 + 20_500 + 32_200 - 20_500)

    const pending = await readOutbox(page)
    expect(pending.length).toBeGreaterThanOrEqual(5)

    // Arrives at the server when online.
    await ctx.setOffline(false)
    const acked = await waitOutboxAllAcked(page, 90_000)
    expect(acked).toBeGreaterThanOrEqual(5)

    await withTenant(t.tenantId, async (tx) => {
      const sales = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM sale WHERE tenant_id = ${t.tenantId}`)
      expect(Number(sales.rows[0]!.n)).toBe(3)

      const shifts = await tx.execute<{ status: string }>(
        sql`SELECT status FROM cash_cashier WHERE tenant_id = ${t.tenantId}`,
      )
      expect(shifts.rows.map((r) => r.status)).toEqual(['CLOSED'])

      const cns = await tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM credit_note WHERE tenant_id = ${t.tenantId}`,
      )
      expect(Number(cns.rows[0]!.n)).toBe(1)

      // Invoice numbers contiguous 1..3 on register POS01 (no gaps).
      const seqs = await tx.execute<{ invoice_seq: number }>(
        sql`SELECT invoice_seq FROM sale WHERE tenant_id = ${t.tenantId} ORDER BY invoice_seq`,
      )
      expect(seqs.rows.map((r) => Number(r.invoice_seq))).toEqual([1, 2, 3])

      const gaps = await tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM invoice_gap WHERE tenant_id = ${t.tenantId}`,
      )
      expect(Number(gaps.rows[0]!.n)).toBe(0)

      const attention = await tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM attention_item WHERE tenant_id = ${t.tenantId}`,
      )
      expect(Number(attention.rows[0]!.n)).toBe(0)
    })
  })
})
