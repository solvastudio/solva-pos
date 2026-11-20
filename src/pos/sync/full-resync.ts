import { FullPageResponse, FullStartResponse } from '~/lib/contracts'
import { createIdGenerator } from '~/lib/kernel'
import { countMasterEntities } from '../data/master.repo'
import { clearPullStageCycle, stagePullRows } from '../data/pull-stage.repo'
import type { SolvaDb } from '../db/solva-db'
import { logDevice } from '../maintenance/device-log'
import { applyFullResyncSnapshot } from './applier'
import type { SyncClock } from './clock'
import { deviceFetch } from './device-http'
import { buildDeviceReport, runIncrementalPull } from './puller'

const resyncCycleIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})

export interface FullResyncProgress {
  step: number
  total: number
  label: string
}

export type FullResyncResult =
  | { kind: 'ok'; snapshotVersion: number; serverTimeMs?: number }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'failed' }

export interface RunFullResyncOptions {
  db: SolvaDb
  clock: SyncClock
  pushOk?: boolean
  fetch?: typeof fetch
  onProgress?: (p: FullResyncProgress) => void
  onAuthTerminal?: (code: 'DEVICE_REVOKED' | 'CREDENTIAL_EXPIRED' | 'TENANT_SUSPENDED') => void
  _attempt?: number
}

function countsMatch(
  actual: Record<string, number>,
  expected: Record<string, number>,
  entities: readonly string[],
): boolean {
  for (const entity of entities) {
    if (entity in expected && (actual[entity] ?? 0) !== expected[entity]) {
      return false
    }
  }
  return true
}

/**
 * Performs a full keyset resync (`pull/full/start` -> `pull/full/page` per entity ->
 * atomic master-only snapshot swap -> manifest verification -> incremental catch-up).
 */
export async function runFullResync(
  opts: RunFullResyncOptions,
): Promise<FullResyncResult> {
  const attempt = opts._attempt ?? 0
  const report = await buildDeviceReport(opts.db, {
    pushOk: opts.pushOk ?? true,
    clock: opts.clock,
  })

  const startRes = await deviceFetch<unknown>('/api/pos/v1/pull/full/start', {
    method: 'POST',
    db: opts.db,
    clock: opts.clock,
    timeoutMs: 30_000,
    fetch: opts.fetch,
    onTerminalAuthLock: opts.onAuthTerminal,
    body: { report },
  })

  if (startRes.kind === 'rate_limited') {
    return { kind: 'rate_limited', retryAfterMs: startRes.retryAfterMs }
  }
  if (startRes.kind !== 'ok') {
    return { kind: 'failed' }
  }

  const startParsed = FullStartResponse.parse(startRes.data)
  const cycleId = resyncCycleIdGen.newId()
  const totalEntities = Math.max(1, startParsed.entities.length)

  try {
    for (let idx = 0; idx < startParsed.entities.length; idx += 1) {
      const entity = startParsed.entities[idx]!
      opts.onProgress?.({
        step: idx + 1,
        total: totalEntities,
        label: entity,
      })

      let afterId: string | null = null
      while (true) {
        const pageRes = await deviceFetch<unknown>('/api/pos/v1/pull/full/page', {
          method: 'POST',
          db: opts.db,
          clock: opts.clock,
          timeoutMs: 30_000,
          fetch: opts.fetch,
          onTerminalAuthLock: opts.onAuthTerminal,
          body: {
            snapshot_token: startParsed.snapshot_token,
            entity,
            after_id: afterId,
            page_size: 500,
          },
        })

        if (pageRes.kind === 'rate_limited') {
          await clearPullStageCycle(opts.db, cycleId)
          return { kind: 'rate_limited', retryAfterMs: pageRes.retryAfterMs }
        }
        if (pageRes.kind !== 'ok') {
          await clearPullStageCycle(opts.db, cycleId)
          return { kind: 'failed' }
        }

        const page = FullPageResponse.parse(pageRes.data)
        if (page.rows.length > 0) {
          await stagePullRows(
            opts.db,
            page.rows.map((r) => ({
              cycle_id: cycleId,
              entity: r.entity,
              op: r.op,
              id: r.id,
              version: r.version,
              payload: r.row ?? {},
            })),
          )
        }

        afterId = page.next_after_id
        if (!page.has_more) {
          break
        }
      }
    }

    await applyFullResyncSnapshot(opts.db, {
      cycleId,
      snapshotVersion: startParsed.snapshot_version,
      immediate: true,
    })

    const actualCounts = await countMasterEntities(opts.db, startParsed.entities)
    if (!countsMatch(actualCounts, startParsed.manifest.counts, startParsed.entities)) {
      if (attempt === 0) {
        return runFullResync({ ...opts, _attempt: 1 })
      }
      await logDevice(opts.db, {
        level: 'warn',
        code: 'SYNC_FAILED',
        ctx: { reason: 'manifest_count_mismatch' },
      }).catch(() => {})
    }

    // Catch up any delta committed after snapshot_version.
    const catchUp = await runIncrementalPull({
      db: opts.db,
      clock: opts.clock,
      pushOk: opts.pushOk ?? true,
      immediateApply: true,
      fetch: opts.fetch,
      onAuthTerminal: opts.onAuthTerminal,
    })

    return {
      kind: 'ok',
      snapshotVersion: startParsed.snapshot_version,
      serverTimeMs: catchUp.kind === 'ok' ? catchUp.serverTimeMs : startRes.serverTimeMs,
    }
  } catch {
    await clearPullStageCycle(opts.db, cycleId).catch(() => {})
    return { kind: 'failed' }
  }
}
