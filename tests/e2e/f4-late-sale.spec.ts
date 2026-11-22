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
  waitOutboxAllAcked,
} from './helpers/pos'
import { F3_CASHIER_NAME, F3_CASHIER_PIN, F3_PRODUCTS, createF3Tenant, pairingCodeFor } from './helpers/seed-f3'

test.use({ locale: 'id-ID' })

/** Business date in Asia/Jakarta today (YYYY-MM-DD). */
function jakartaToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
}

test.describe('F4-K02 late-arriving offline sale', () => {
  test('F4-K02 device offline sells 10 pcs; admin posts GR on the server; when online cost_snapshot = 82.083 and balance 110/902.917', async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const t = await createF3Tenant('f4k02')
    // Stock is enabled before the sale (BR-STK-004).
    await enableOutletTracking(t.ownerActor, t.outletId)
    const kopiSku = t.productIds.kopi.skuId

    const code = await pairingCodeFor(t, t.reg1Id)
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    await pairDeviceViaUi(page, t.slug, code, 'E2E Kasir F4-K02')
    await loginStaffPin(page, F3_CASHIER_NAME, F3_CASHIER_PIN)
    await page.waitForFunction(() => Boolean((window as { __solva?: unknown }).__solva), { timeout: 15_000 })
    await expect
      .poll(() => page.evaluate(() => window.__solva!.catalog.count()), { timeout: 20_000 })
      .toBe(3)
    await openShiftUi(page, 500_000)
    await selectVirtualPrinter(page)

    // Offline: 10 Kopi Hitam sold on the device (no stock on the server yet).
    await ctx.setOffline(true)
    for (let i = 0; i < 10; i++) {
      await scanBarcode(page, F3_PRODUCTS.kopi.barcode)
    }
    await payAndFinish(page, [{ method: 'CASH', amount: 210_000 }])

    // Admin posts a receipt of 120 pcs at Rp985,000 on the server (average 8,208.33) while the device is offline.
    const draft = await saveGrDraft(t.ownerActor, {
      outletId: t.outletId,
      businessDate: jakartaToday(),
      lines: [{ skuId: kopiSku, uomId: t.pcsUomId, qty: '120', lineValue: 985_000, unitCost: null }],
    })
    await postGr(t.ownerActor, draft.id)

    // Arrives at the server online: the sale is processed using the cost at processing time.
    await ctx.setOffline(false)
    await waitOutboxAllAcked(page, 90_000)

    await withTenant(t.tenantId, async (tx) => {
      const lines = await tx.execute<{ cost_snapshot: string | null; qty: string }>(sql`
        SELECT sl.cost_snapshot::text AS cost_snapshot, sl.qty_base::text AS qty
        FROM sale_line sl
        JOIN sale s ON s.tenant_id = sl.tenant_id AND s.id = sl.sale_id
        WHERE sl.tenant_id = ${t.tenantId}::uuid AND sl.sku_id = ${kopiSku}::uuid`)
      const totalCost = lines.rows.reduce((acc, r) => acc + Number(r.cost_snapshot ?? 0), 0)
      const totalQty = lines.rows.reduce((acc, r) => acc + Number(r.qty), 0)
      expect(totalQty).toBe(10)
      // R(985,000 × 10 / 120) = 82,083 (not 80,000 from the estimate).
      expect(totalCost).toBe(82_083)

      const bal = await tx.execute<{ qty: string; inventory_value: string }>(sql`
        SELECT qty::text AS qty, inventory_value::text AS inventory_value FROM stock_balance
        WHERE tenant_id = ${t.tenantId}::uuid AND outlet_id = ${t.outletId}::uuid AND sku_id = ${kopiSku}::uuid`)
      expect(Number(bal.rows[0]!.qty)).toBe(110)
      expect(Number(bal.rows[0]!.inventory_value)).toBe(902_917)

      // Event time (device, offline) and server receipt time differ: a late sale.
      const times = await tx.execute<{ same: boolean }>(sql`
        SELECT (s.occurred_at = s.received_at) AS same FROM sale s
        WHERE s.tenant_id = ${t.tenantId}::uuid LIMIT 1`)
      expect(times.rows[0]!.same).toBe(false)
    })
  })
})
