import { expect, test } from '@playwright/test'
import { createThreeOutletE2eTenant } from '../../scripts/bench/seed-catalog'
import { pairDeviceViaUi } from './helpers/device'
import { createPairingCodeDirect, recordF2Metric } from './helpers/server'

test.describe('F2-BENCH RSK-A04 client Dexie apply scale benchmark', () => {
  test('F2-BENCH applies 25,000 mixed master rows inside Chromium IndexedDB within soft 10s budget', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const tenant = await createThreeOutletE2eTenant('f2bench')
    const code = await createPairingCodeDirect(
      tenant.tenantId,
      tenant.registerAId,
      tenant.actorUserId,
    )

    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await pairDeviceViaUi(page, tenant.slug, code, 'E2E Bench Apply 25k')

      const result = await page.evaluate(async (outletId) => {
        const rows: Array<{
          entity: string
          op: 'upsert'
          id: string
          version: number
          payload: Record<string, unknown>
        }> = []

        const catId = '0192b000-0000-7000-8000-000000000001'
        const uomId = '0192b000-0000-7000-8000-000000000002'

        // 2,500 products + 7,500 SKUs + 7,500 sku_uom + 5,000 price_entry + 2,500 item_outlet_availability = 25,000 rows
        for (let p = 0; p < 2500; p += 1) {
          const pHex = p.toString(16).padStart(12, '0')
          const prodId = `0192b001-0000-7000-8000-${pHex}`
          rows.push({
            entity: 'product',
            op: 'upsert',
            id: prodId,
            version: 100,
            payload: {
              category_id: catId,
              code: `BM-${p}`,
              name: `Benchmark Mixed Item ${p}`,
              product_type: 'RETAIL',
              has_variants: true,
              base_uom_id: uomId,
              track_stock: true,
              taxable: true,
              is_active: true,
              is_open_price: false,
              sort_order: p,
            },
          })

          rows.push({
            entity: 'item_outlet_availability',
            op: 'upsert',
            id: `0192b005-0000-7000-8000-${pHex}`,
            version: 100,
            payload: {
              outlet_id: outletId,
              product_id: prodId,
              sku_id: null,
              status: 'AVAILABLE',
            },
          })

          for (let v = 0; v < 3; v += 1) {
            const idx = p * 3 + v
            const sHex = idx.toString(16).padStart(12, '0')
            const skuId = `0192b002-0000-7000-8000-${sHex}`
            rows.push({
              entity: 'sku',
              op: 'upsert',
              id: skuId,
              version: 100,
              payload: {
                product_id: prodId,
                sku_code: `BM-${p}-V${v}`,
                variant_label: `V${v}`,
                is_default: v === 0,
                is_active: true,
                sort_order: v,
              },
            })

            rows.push({
              entity: 'sku_uom',
              op: 'upsert',
              id: `0192b003-0000-7000-8000-${sHex}`,
              version: 100,
              payload: {
                sku_id: skuId,
                uom_id: uomId,
                conversion_factor: '1',
                is_base: true,
                barcode: idx % 10 === 0 ? null : `889${String(idx).padStart(10, '0')}`,
              },
            })

            if (idx < 5000) {
              rows.push({
                entity: 'price_entry',
                op: 'upsert',
                id: `0192b004-0000-7000-8000-${sHex}`,
                version: 100,
                payload: {
                  sku_id: skuId,
                  uom_id: uomId,
                  outlet_id: null,
                  price: 15000 + v * 500,
                  currency: 'IDR',
                },
              })
            }
          }
        }

        const applyRes = await window.__solva!.catalog.benchmarkApplyRows(rows)
        return { rowCount: rows.length, durationMs: applyRes.durationMs }
      }, tenant.outletAId)

      console.log(
        `[bench:apply-25k] rows=${result.rowCount} duration=${result.durationMs.toFixed(1)} ms (budget <= 10000 ms)`,
      )
      await recordF2Metric('apply25k', {
        rowCount: result.rowCount,
        durationMs: Number(result.durationMs.toFixed(1)),
      })

      expect(result.rowCount).toBe(25_000)
      expect(result.durationMs).toBeLessThanOrEqual(10_000)
    } finally {
      await ctx.close()
    }
  })
})
