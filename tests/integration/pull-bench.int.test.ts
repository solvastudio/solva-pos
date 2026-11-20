import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { formatPullBenchmarkTable, runPullBenchmark } from '../../scripts/bench/pull-benchmark'
import { seedCatalogBenchmark } from '../../scripts/bench/seed-catalog'

describe('pull-bench: 5,000-SKU catalog pull & full resync benchmark (tag: bench)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
  })

  afterAll(async () => {
    resetCompositionForTests()
    await closePools()
  })

  it('meets p95 <= 600ms per 500-row page without Seq Scan on catalog selectKeys', { timeout: 120_000 }, async () => {
    const seeded = await seedCatalogBenchmark('pbench')
    const bench = await runPullBenchmark(seeded.deviceA)
    console.info(`\n${formatPullBenchmarkTable(bench)}\n`)

    // NFR-PERF-006 / RSK-A04 server-side compute budget: p95 <= 600 ms
    expect(bench.incremental.p95PageMs).toBeLessThanOrEqual(600)
    expect(bench.incremental.totalRows).toBeGreaterThanOrEqual(27_000)

    for (const plan of bench.explain) {
      expect(plan.usesSeqScan, `${plan.label} fell back to Seq Scan:\n${plan.planLines.join('\n')}`).toBe(
        false,
      )
    }
  })
})
