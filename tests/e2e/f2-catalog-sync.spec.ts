import { expect, test } from '@playwright/test'
import { seedCatalogBenchmark } from '../../scripts/bench/seed-catalog'
import { pairDeviceViaUi } from './helpers/device'
import {
  clearActiveDevicesOnRegister,
  createPairingCodeDirect,
  recordF2Metric,
} from './helpers/server'

test.describe('F2-K01 catalog sync 5,000 SKUs and NFR-PERF-003 local lookup latency', () => {
  test('F2-K01 syncs 5,000 SKUs including null-barcode rows and meets barcode/search latency budgets', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const seeded = await seedCatalogBenchmark('f2k01', { nullBarcodeEveryN: 50 })
    await clearActiveDevicesOnRegister(seeded.tenantId, seeded.registerAId)
    const code = await createPairingCodeDirect(
      seeded.tenantId,
      seeded.registerAId,
      seeded.actorUserId,
    )

    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await pairDeviceViaUi(page, seeded.slug, code, 'E2E Cashier K01', 60_000)

      // Wait for full resync to land all 5,000 SKUs locally in Dexie.
      await expect
        .poll(() => page.evaluate(() => window.__solva!.catalog.count()), {
          timeout: 45_000,
          intervals: [500],
        })
        .toBe(5_000)

      const bench = await page.evaluate(async () => {
        const percentile95 = (arr: number[]) => {
          const sorted = [...arr].sort((a, b) => a - b)
          const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
          return sorted[idx] ?? 0
        }

        const barcodeTimings: number[] = []
        let barcodeHits = 0
        for (let i = 1; i <= 200; i += 1) {
          // Ensure picked barcodes are non-null (skipping every 50th).
          const rn = i % 50 === 0 ? i + 1 : i
          const barcode = `89900${String(rn).padStart(8, '0')}`
          const t0 = performance.now()
          const hit = await window.__solva!.catalog.findByBarcode(barcode)
          barcodeTimings.push(performance.now() - t0)
          if (hit) barcodeHits += 1
        }

        const searchTerms = [
          'Bench Product 1',
          'Bench Product 25',
          'BP-01',
          'BP-04',
          'Product 99',
          'Bench',
          'BP-1200',
          'Product 500',
        ]
        const searchTimings: number[] = []
        let nonEmptySearches = 0
        for (let i = 0; i < 200; i += 1) {
          const term = searchTerms[i % searchTerms.length]!
          const t0 = performance.now()
          const res = await window.__solva!.catalog.searchProducts(term, { limit: 50 })
          searchTimings.push(performance.now() - t0)
          if (res.length > 0) nonEmptySearches += 1
        }

        return {
          barcodeHits,
          nonEmptySearches,
          barcodeP50Ms: [...barcodeTimings].sort((a, b) => a - b)[99] ?? 0,
          barcodeP95Ms: percentile95(barcodeTimings),
          searchP50Ms: [...searchTimings].sort((a, b) => a - b)[99] ?? 0,
          searchP95Ms: percentile95(searchTimings),
        }
      })

      console.log(
        `[F2-K01] barcode p50=${bench.barcodeP50Ms.toFixed(2)}ms p95=${bench.barcodeP95Ms.toFixed(2)}ms | search p50=${bench.searchP50Ms.toFixed(2)}ms p95=${bench.searchP95Ms.toFixed(2)}ms`,
      )
      await recordF2Metric('k01Lookup', {
        barcodeP50Ms: Number(bench.barcodeP50Ms.toFixed(2)),
        barcodeP95Ms: Number(bench.barcodeP95Ms.toFixed(2)),
        searchP50Ms: Number(bench.searchP50Ms.toFixed(2)),
        searchP95Ms: Number(bench.searchP95Ms.toFixed(2)),
      })

      expect(bench.barcodeHits).toBe(200)
      expect(bench.nonEmptySearches).toBe(200)
      expect(bench.barcodeP95Ms).toBeLessThanOrEqual(100)
      expect(bench.searchP95Ms).toBeLessThanOrEqual(300)
    } finally {
      await ctx.close()
    }
  })
})
