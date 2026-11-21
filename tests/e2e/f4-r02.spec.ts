import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { enableOutletTracking, postGr, saveGrDraft } from '../../src/modules/inventory/public'
import { withTenant } from '../../src/server/db'
import { loginAdminUi } from './helpers/admin'
import { F3_OWNER_PASSWORD, createF3Tenant } from './helpers/seed-f3'

test.use({ locale: 'id-ID' })

function jakartaToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
}

test.describe('F4-K04 laporan R-02 sesuai ledger', () => {
  test('F4-K04 GR 120 pcs @985.000 tampil di R-02 (saldo 120 / 985.000); Σ value_delta ledger = nilai saldo', async ({ page }) => {
    test.setTimeout(120_000)
    const t = await createF3Tenant('f4r02')
    await enableOutletTracking(t.ownerActor, t.outletId)
    const kopiSku = t.productIds.kopi.skuId

    const draft = await saveGrDraft(t.ownerActor, {
      outletId: t.outletId,
      businessDate: jakartaToday(),
      lines: [{ skuId: kopiSku, uomId: t.pcsUomId, qty: '120', lineValue: 985_000, unitCost: null }],
    })
    await postGr(t.ownerActor, draft.id)

    // Rekonsiliasi (K04): untuk setiap (outlet, SKU), jumlah value_delta ledger = inventory_value saldo.
    await withTenant(t.tenantId, async (tx) => {
      const rows = await tx.execute<{ bal: string; mv: string }>(sql`
        SELECT b.inventory_value::text AS bal, COALESCE(m.s, 0)::text AS mv
        FROM stock_balance b
        LEFT JOIN (
          SELECT outlet_id, sku_id, sum(value_delta) AS s FROM stock_movement
          WHERE tenant_id = ${t.tenantId}::uuid GROUP BY outlet_id, sku_id
        ) m ON m.outlet_id = b.outlet_id AND m.sku_id = b.sku_id
        WHERE b.tenant_id = ${t.tenantId}::uuid`)
      expect(rows.rows.length).toBeGreaterThan(0)
      for (const r of rows.rows) expect(Number(r.mv)).toBe(Number(r.bal))
    })

    await loginAdminUi(page, t.slug, `owner-${t.slug}@example.test`, F3_OWNER_PASSWORD)
    await page.goto(`/${t.slug}/admin/stock`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Stok & Persediaan' })).toBeVisible({ timeout: 15_000 })
    // Saldo: 120 pcs dan nilai Rp985.000 (tampil di ringkasan dan tabel saldo).
    await expect(page.getByRole('cell', { name: '120', exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('985.000').first()).toBeVisible()
    await expect(page.getByText('KOPI').first()).toBeVisible()
  })
})
