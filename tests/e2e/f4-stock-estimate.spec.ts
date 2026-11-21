import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { enableOutletTracking, postGr, saveGrDraft } from '../../src/modules/inventory/public'
import { withTenant } from '../../src/server/db'
import { pairDeviceViaUi } from './helpers/device'
import {
  loginStaffPin,
  openShiftUi,
  payAndFinish,
  scanBarcode,
  selectVirtualPrinter,
  startNewSale,
  waitOutboxAllAcked,
} from './helpers/pos'
import { F3_CASHIER_NAME, F3_CASHIER_PIN, F3_PRODUCTS, createF3Tenant, pairingCodeFor } from './helpers/seed-f3'

test.use({ locale: 'id-ID' })

function jakartaToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
}

test.describe('F4 estimasi stok di POS (FR-POS-011, BR-STK-005)', () => {
  test('F4-EST snapshot 20, jual 6 offline ⇒ estimasi 14; ≤ 0 ⇒ chip, tombol bayar tetap aktif', async ({ browser }) => {
    test.setTimeout(300_000)
    const t = await createF3Tenant('f4est')
    await enableOutletTracking(t.ownerActor, t.outletId)
    const kopiSku = t.productIds.kopi.skuId
    const draft = await saveGrDraft(t.ownerActor, {
      outletId: t.outletId,
      businessDate: jakartaToday(),
      lines: [{ skuId: kopiSku, uomId: t.pcsUomId, qty: '20', lineValue: 160_000, unitCost: null }],
    })
    await postGr(t.ownerActor, draft.id)

    const code = await pairingCodeFor(t, t.reg1Id)
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await pairDeviceViaUi(page, t.slug, code, 'E2E Kasir F4-EST')
    await loginStaffPin(page, F3_CASHIER_NAME, F3_CASHIER_PIN)
    await page.waitForFunction(() => Boolean((window as { __solva?: unknown }).__solva), { timeout: 15_000 })
    await expect
      .poll(() => page.evaluate(() => window.__solva!.catalog.count()), { timeout: 20_000 })
      .toBe(3)
    await openShiftUi(page, 500_000)
    await selectVirtualPrinter(page)

    // Snapshot stok (20) sampai ke perangkat lewat pull.
    await expect(page.getByText('Stok 20', { exact: true }).first()).toBeVisible({ timeout: 30_000 })

    // Offline: jual 6 Kopi Hitam ⇒ estimasi 14.
    await ctx.setOffline(true)
    for (let i = 0; i < 6; i++) await scanBarcode(page, F3_PRODUCTS.kopi.barcode)
    await payAndFinish(page, [{ method: 'CASH', amount: 130_000 }])
    await startNewSale(page)
    await expect(page.getByText('Stok 14', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

    // Jual 14 lagi ⇒ estimasi 0: chip non-blokir, dan penjualan tetap dapat dibayar.
    for (let i = 0; i < 14; i++) await scanBarcode(page, F3_PRODUCTS.kopi.barcode)
    await payAndFinish(page, [{ method: 'CASH', amount: 300_000 }])
    await startNewSale(page)
    await expect(page.getByText('Stok estimasi ≤ 0').first()).toBeVisible({ timeout: 15_000 })
    await scanBarcode(page, F3_PRODUCTS.kopi.barcode)
    await expect(page.getByRole('button', { name: /^Bayar/ })).toBeEnabled()

    // Tiba di server: 20 terjual dari snapshot 20 ⇒ saldo 0 (tidak negatif), tanpa flag stok minus.
    // Item ke-21 hanya masuk keranjang dan tidak dibayar, jadi tidak membuat movement.
    await ctx.setOffline(false)
    await waitOutboxAllAcked(page, 120_000)
    await withTenant(t.tenantId, async (tx) => {
      const bal = await tx.execute<{ qty: string }>(sql`
        SELECT qty::text AS qty FROM stock_balance
        WHERE tenant_id = ${t.tenantId}::uuid AND outlet_id = ${t.outletId}::uuid AND sku_id = ${kopiSku}::uuid`)
      expect(Number(bal.rows[0]!.qty)).toBe(0)
      const flags = await tx.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM data_flag WHERE tenant_id = ${t.tenantId}::uuid AND flag_code = 'STOK_MINUS'`)
      expect(Number(flags.rows[0]!.n)).toBe(0)
    })
  })
})
