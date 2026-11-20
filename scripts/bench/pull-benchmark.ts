import { performance } from 'node:perf_hooks'
import { sql } from 'drizzle-orm'
import {
  fullResyncPage,
  FULL_RESYNC_ENTITY_ORDER,
  pullPage,
  startFullResync,
  startPullCycle,
  type FeedCursor,
  type SyncDeviceIdentity,
} from '~/modules/sync/public'
import { withTenantReadOnly } from '~/server/db'

export interface PullExplainSummary {
  label: string
  planLines: string[]
  usesSeqScan: boolean
}

export interface PullBenchmarkResult {
  incremental: {
    pages: number
    totalRows: number
    totalMs: number
    p50PageMs: number
    p95PageMs: number
    maxPageMs: number
  }
  fullResync: {
    totalRows: number
    totalMs: number
    byEntity: Array<{ entity: string; rows: number; pages: number; totalMs: number }>
  }
  explain: PullExplainSummary[]
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return Number(sorted[idx]!.toFixed(2))
}

export async function runPullBenchmark(device: SyncDeviceIdentity): Promise<PullBenchmarkResult> {
  const scope = {
    tenantId: device.tenantId,
    outletId: device.outletId,
    registerId: device.registerId,
    deviceId: device.deviceId,
  }

  // 1. Incremental pull from null cursor in pages of 500
  const cycle = await startPullCycle(device.tenantId)
  let cursor: FeedCursor | null = null
  const pageDurations: number[] = []
  let incrementalRows = 0
  const incStart = performance.now()

  while (true) {
    const t0 = performance.now()
    const res = await pullPage({
      tenantId: device.tenantId,
      scope,
      cursor,
      cycleUpper: cycle.upper,
      pageSize: 500,
    })
    const dt = performance.now() - t0
    if (res.fullResyncRequired) {
      throw new Error('Unexpected full resync required during clean pull benchmark')
    }
    pageDurations.push(dt)
    incrementalRows += res.rows.length
    cursor = res.nextCursor
    if (!res.hasMore) break
  }

  const incTotalMs = Number((performance.now() - incStart).toFixed(2))
  const sortedPages = [...pageDurations].sort((a, b) => a - b)

  // 2. Full resync across all entities in FULL_RESYNC_ENTITY_ORDER
  const fsStart = performance.now()
  const fsInit = await startFullResync(
    device,
    {},
    { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'bench-fs' },
  )
  let fsTotalRows = 0
  const byEntity: PullBenchmarkResult['fullResync']['byEntity'] = []

  for (const entity of FULL_RESYNC_ENTITY_ORDER) {
    const eStart = performance.now()
    let afterId: string | null = null
    let entityRows = 0
    let entityPages = 0
    while (true) {
      const page = await fullResyncPage(device, {
        snapshot_token: fsInit.snapshot_token,
        entity,
        after_id: afterId,
        page_size: 500,
      })
      entityPages += 1
      entityRows += page.rows.length
      if (!page.has_more) break
      afterId = page.next_after_id
    }
    const eMs = Number((performance.now() - eStart).toFixed(2))
    fsTotalRows += entityRows
    byEntity.push({ entity, rows: entityRows, pages: entityPages, totalMs: eMs })
  }
  const fsTotalMs = Number((performance.now() - fsStart).toFixed(2))

  // 3. EXPLAIN (ANALYZE) for selectKeys on main large tables (enable_seqscan forced off? No: real planner plan!)
  const explain = await withTenantReadOnly(device.tenantId, async (tx) => {
    const queries: Array<{ label: string; stmt: ReturnType<typeof sql> }> = [
      {
        label: 'sku.selectKeys',
        stmt: sql`EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT id, version FROM sku
          WHERE tenant_id = ${device.tenantId}::uuid AND version <= ${cycle.upper}
          ORDER BY version ASC, id ASC LIMIT 501`,
      },
      {
        label: 'sku_uom.selectKeys',
        stmt: sql`EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT id, version FROM sku_uom
          WHERE tenant_id = ${device.tenantId}::uuid AND version <= ${cycle.upper}
          ORDER BY version ASC, id ASC LIMIT 501`,
      },
      {
        label: 'item_outlet_availability.selectKeys',
        stmt: sql`EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT id, version FROM item_outlet_availability
          WHERE tenant_id = ${device.tenantId}::uuid AND outlet_id = ${device.outletId}::uuid AND version <= ${cycle.upper}
          ORDER BY version ASC, id ASC LIMIT 501`,
      },
      {
        label: 'price_entry.selectKeys[outlet]',
        stmt: sql`EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT id, version FROM price_entry
          WHERE tenant_id = ${device.tenantId}::uuid
            AND outlet_id = ${device.outletId}::uuid
            AND version <= ${cycle.upper}
          ORDER BY version ASC, id ASC LIMIT 501`,
      },
      {
        label: 'price_entry.selectKeys[default]',
        stmt: sql`EXPLAIN (ANALYZE, FORMAT TEXT)
          SELECT id, version FROM price_entry
          WHERE tenant_id = ${device.tenantId}::uuid
            AND outlet_id IS NULL
            AND version <= ${cycle.upper}
          ORDER BY version ASC, id ASC LIMIT 501`,
      },
    ]

    const summaries: PullExplainSummary[] = []
    for (const q of queries) {
      const res = await tx.execute(q.stmt)
      const planLines = res.rows.map((r) => String((r as { 'QUERY PLAN': string })['QUERY PLAN']))
      const usesSeqScan = planLines.some((line) => line.includes('Seq Scan'))
      summaries.push({ label: q.label, planLines, usesSeqScan })
    }
    return summaries
  })

  return {
    incremental: {
      pages: pageDurations.length,
      totalRows: incrementalRows,
      totalMs: incTotalMs,
      p50PageMs: percentile(sortedPages, 50),
      p95PageMs: percentile(sortedPages, 95),
      maxPageMs: Number((sortedPages[sortedPages.length - 1] ?? 0).toFixed(2)),
    },
    fullResync: {
      totalRows: fsTotalRows,
      totalMs: fsTotalMs,
      byEntity,
    },
    explain,
  }
}

export function formatPullBenchmarkTable(res: PullBenchmarkResult): string {
  const lines = [
    '=== Pull Benchmark (5,000 SKUs / 3 Outlets) ===',
    `Incremental Pull: pages=${res.incremental.pages}, rows=${res.incremental.totalRows}, totalMs=${res.incremental.totalMs}, p50=${res.incremental.p50PageMs}ms, p95=${res.incremental.p95PageMs}ms, max=${res.incremental.maxPageMs}ms`,
    `Full Resync: totalRows=${res.fullResync.totalRows}, totalMs=${res.fullResync.totalMs}ms`,
    'Entity breakdown:',
    ...res.fullResync.byEntity
      .filter((e) => e.rows > 0)
      .map((e) => `  - ${e.entity}: rows=${e.rows}, pages=${e.pages}, ms=${e.totalMs}`),
    'EXPLAIN ANALYZE selectKeys:',
    ...res.explain.map(
      (e) => `  - ${e.label}: seqScan=${e.usesSeqScan} | ${e.planLines[0] ?? ''}`,
    ),
  ]
  return lines.join('\n')
}
