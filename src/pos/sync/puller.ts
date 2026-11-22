import { APP_VERSION } from '~/lib/app-version'
import {
  PullResponse,
  SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  type DeviceReport,
} from '~/lib/contracts'
import { createIdGenerator } from '~/lib/kernel'
import { getMeta, setMeta } from '../data/meta.repo'
import { getOutboxQueueSummary } from '../data/outbox.repo'
import { applyStockSnapshot } from '../data/stock.repo'
import { clearPullStageCycle, stagePullRows } from '../data/pull-stage.repo'
import type { SolvaDb } from '../db/solva-db'
import { applyPullCycle, LARGE_INCREMENTAL_THRESHOLD } from './applier'
import type { SyncClock } from './clock'
import { applyCommandUpdates } from './command-updates'
import { logDevice } from '../maintenance/device-log'
import { deviceFetch, type DeviceAuthFailureCode } from './device-http'

export const DEFAULT_PULL_PAGE_SIZE = 500
export const DEFAULT_PULL_TIMEOUT_MS = 15_000
export const UNSTABLE_PULL_TIMEOUT_MS = 30_000

const cycleIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})

export type PullRunResult =
  | { kind: 'ok'; serverTimeMs?: number; pages: number }
  | { kind: 'full_resync_required'; reason: 'CURSOR_BELOW_FLOOR' | 'SCHEMA_INCOMPATIBLE' }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'auth'; code: DeviceAuthFailureCode }
  | { kind: 'update_required' }
  | { kind: 'transient' }

export interface RunIncrementalPullOptions {
  db: SolvaDb
  clock: SyncClock
  pushOk: boolean
  lastErrorCode?: string | null
  lastErrorRef?: string | null
  unstable?: boolean
  immediateApply?: boolean
  fetch?: typeof fetch
  onAuthTerminal?: (code: 'DEVICE_REVOKED' | 'CREDENTIAL_EXPIRED' | 'TENANT_SUSPENDED') => void
}

export async function buildDeviceReport(
  db: SolvaDb,
  opts: {
    pushOk: boolean
    clock: SyncClock
    lastErrorCode?: string | null
    lastErrorRef?: string | null
  },
): Promise<DeviceReport> {
  const [queue, storageMeta] = await Promise.all([
    getOutboxQueueSummary(db),
    getMeta(db, 'storage'),
  ])

  const appVerClean = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(APP_VERSION)
    ? APP_VERSION.slice(0, 30)
    : null

  return {
    push_ok: opts.pushOk,
    pending_count: queue.pending,
    oldest_pending_at: queue.oldestAt,
    attention_count: queue.attention,
    storage_persist: storageMeta?.persist ?? 'UNKNOWN',
    storage_used_pct:
      storageMeta && Number.isFinite(storageMeta.used_pct)
        ? Math.min(100, Math.max(0, Math.round(storageMeta.used_pct)))
        : null,
    last_error_code: opts.lastErrorCode ?? null,
    last_error_ref: opts.lastErrorRef ?? null,
    clock_offset_ms: Math.round(opts.clock.getOffsetMs()),
    app_version: appVerClean,
    schema_version: SCHEMA_VERSION,
    sync_protocol_version: SYNC_PROTOCOL_VERSION,
  }
}

/**
 * Stages incremental `/pull` pages into `pull_stage` + `meta.stage` across pages
 * (crash-resumable), then atomically commits all staged rows once `has_more = false`.
 */
export async function runIncrementalPull(
  opts: RunIncrementalPullOptions,
): Promise<PullRunResult> {
  const existingStage = await getMeta(opts.db, 'stage')
  const baseCursor = await getMeta(opts.db, 'cursor')

  const cycleId = existingStage?.cycle_id ?? cycleIdGen.newId()
  let cycleUpper: number | null = existingStage?.upper?.version ?? null
  let currentCursor = existingStage ? (existingStage.cursor ?? baseCursor) : baseCursor
  let pagesDone = existingStage?.pages ?? 0

  const queue = await getOutboxQueueSummary(opts.db)
  const report = await buildDeviceReport(opts.db, {
    pushOk: opts.pushOk,
    clock: opts.clock,
    lastErrorCode: opts.lastErrorCode,
    lastErrorRef: opts.lastErrorRef,
  })

  const timeoutMs = opts.unstable ? UNSTABLE_PULL_TIMEOUT_MS : DEFAULT_PULL_TIMEOUT_MS
  let lastServerTimeMs: number | undefined
  let stagedRowCount = 0

  // Etag of the last stock snapshot; the server only sends the `stock` block when it changes.
  const stockEtag = (await getMeta(opts.db, 'stock_snapshot_meta'))?.etag ?? null

  while (true) {
    const res = await deviceFetch<unknown>('/api/pos/v1/pull', {
      method: 'POST',
      db: opts.db,
      clock: opts.clock,
      timeoutMs,
      fetch: opts.fetch,
      onTerminalAuthLock: opts.onAuthTerminal,
      body: {
        cursor: currentCursor,
        cycle: cycleUpper !== null ? { id: cycleId, upper: cycleUpper } : null,
        page_size: DEFAULT_PULL_PAGE_SIZE,
        attention_ids: queue.attentionIds,
        stock_etag: stockEtag,
        // Included cleanly so whichever page finishes (`has_more: false`) persists DeviceReport.
        report,
      },
    })

    if (res.kind === 'rate_limited') {
      return { kind: 'rate_limited', retryAfterMs: res.retryAfterMs }
    }
    if (res.kind === 'auth') {
      return { kind: 'auth', code: res.code }
    }
    if (res.kind === 'update_required') {
      return { kind: 'update_required' }
    }
    if (res.kind !== 'ok') {
      return { kind: 'transient' }
    }

    lastServerTimeMs = res.serverTimeMs
    const parsed = PullResponse.parse(res.data)

    if ('full_resync_required' in parsed) {
      await clearPullStageCycle(opts.db, cycleId)
      await setMeta(opts.db, 'stage', null)
      await setMeta(opts.db, 'full_resync', true)
      return { kind: 'full_resync_required', reason: parsed.reason }
    }

    if (cycleUpper === null) {
      cycleUpper = parsed.upper
    }

    if (parsed.rows.length > 0) {
      stagedRowCount += parsed.rows.length
      if (stagedRowCount > LARGE_INCREMENTAL_THRESHOLD) {
        await clearPullStageCycle(opts.db, cycleId)
        await setMeta(opts.db, 'stage', null)
        await setMeta(opts.db, 'full_resync', true)
        return { kind: 'full_resync_required', reason: 'CURSOR_BELOW_FLOOR' }
      }
      await stagePullRows(
        opts.db,
        parsed.rows.map((r) => ({
          cycle_id: cycleId,
          entity: r.entity,
          op: r.op,
          id: r.id,
          version: r.version,
          payload: r.row ?? {},
        })),
      )
    }

    pagesDone += 1
    currentCursor = parsed.next_cursor

    await setMeta(opts.db, 'stage', {
      cycle_id: cycleId,
      upper: {
        version: cycleUpper,
        id:
          parsed.next_cursor?.id ??
          currentCursor?.id ??
          '00000000-0000-0000-0000-000000000000',
      },
      cursor: parsed.next_cursor,
      stage_cursor: parsed.next_cursor?.version ?? parsed.upper,
      pages: pagesDone,
    })

    if (!parsed.has_more) {
      if (parsed.command_updates && parsed.command_updates.length > 0) {
        await applyCommandUpdates(opts.db, parsed.command_updates, {
          ackedAtIso: new Date(Date.parse(parsed.server_time)).toISOString(),
        })
      }

      await applyPullCycle(opts.db, {
        cycleId,
        finalCursor: parsed.next_cursor,
        catalogCursor: parsed.upper,
        immediate: opts.immediateApply,
      })

      // Stock snapshot: an error must not fail the pull cycle (logged only).
      if (parsed.stock && parsed.stock !== 'unchanged') {
        await applyStockSnapshot(opts.db, parsed.stock).catch(() =>
          logDevice(opts.db, {
            level: 'warn',
            code: 'SYNC_FAILED',
            ctx: { reason: 'stock_snapshot_apply' },
          }).catch(() => {}),
        )
      }

      return {
        kind: 'ok',
        serverTimeMs: lastServerTimeMs ?? Date.parse(parsed.server_time),
        pages: pagesDone,
      }
    }
  }
}
