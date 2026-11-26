import { FullPageResponse, FullStartResponse } from '~/lib/contracts'
import { runtimeIdGenerator as resyncCycleIdGen } from '~/lib/runtime-id'
import { countMasterEntities } from '../data/master.repo'
import { getMeta, setMeta } from '../data/meta.repo'
import {
  discardFullResyncStage,
  isFullResyncStageResumable,
  stageFullResyncPage,
  type FullResyncStageMeta,
} from '../data/pull-stage.repo'
import type { SolvaDb } from '../db/solva-db'
import { logDevice } from '../maintenance/device-log'
import { applyFullResyncSnapshot } from './applier'
import type { SyncClock } from './clock'
import { deviceFetch } from './device-http'
import { buildDeviceReport, runIncrementalPull } from './puller'

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

/** Returns the persisted cycle when it can still be resumed; an expired one is discarded. */
async function loadResumableSession(
  db: SolvaDb,
  nowMs: number,
): Promise<FullResyncStageMeta | null> {
  const stage = await getMeta(db, 'full_resync_stage')
  if (!stage) return null
  if (isFullResyncStageResumable(stage, nowMs)) return stage
  await discardFullResyncStage(db, stage.cycle_id)
  return null
}

/**
 * Performs a full keyset resync (`pull/full/start` -> `pull/full/page` per entity ->
 * atomic master-only snapshot swap -> manifest verification -> incremental catch-up).
 *
 * `pull/full/start` is limited to 1/hour/device, so an interrupted cycle is never restarted: the
 * snapshot token, entity list and page pointer live in `meta.full_resync_stage` and the staged rows in
 * `pull_stage`. The next call continues from the first page that was not stored yet (ARCHITECTURE §4.3).
 */
export async function runFullResync(
  opts: RunFullResyncOptions,
): Promise<FullResyncResult> {
  let session = await loadResumableSession(opts.db, opts.clock.trustedNow())

  if (!session) {
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
    session = {
      cycle_id: resyncCycleIdGen.newId(),
      snapshot_token: startParsed.snapshot_token,
      snapshot_version: startParsed.snapshot_version,
      entities: startParsed.entities,
      counts: startParsed.manifest.counts,
      entity_index: 0,
      after_id: null,
      started_at_ms: opts.clock.trustedNow(),
    }
    await setMeta(opts.db, 'full_resync_stage', session)
  }

  const { cycle_id: cycleId, entities } = session
  const totalEntities = Math.max(1, entities.length)

  try {
    for (let idx = session.entity_index; idx < entities.length; idx += 1) {
      const entity = entities[idx]!
      opts.onProgress?.({
        step: idx + 1,
        total: totalEntities,
        label: entity,
      })

      let afterId: string | null = idx === session.entity_index ? session.after_id : null
      while (true) {
        const pageRes = await deviceFetch<unknown>('/api/pos/v1/pull/full/page', {
          method: 'POST',
          db: opts.db,
          clock: opts.clock,
          timeoutMs: 30_000,
          fetch: opts.fetch,
          onTerminalAuthLock: opts.onAuthTerminal,
          body: {
            snapshot_token: session.snapshot_token,
            entity,
            after_id: afterId,
            page_size: 500,
          },
        })

        if (pageRes.kind === 'rate_limited') {
          return { kind: 'rate_limited', retryAfterMs: pageRes.retryAfterMs }
        }
        if (pageRes.kind !== 'ok') {
          return { kind: 'failed' }
        }

        const page = FullPageResponse.parse(pageRes.data)
        await stageFullResyncPage(
          opts.db,
          page.rows.map((r) => ({
            cycle_id: cycleId,
            entity: r.entity,
            op: r.op,
            id: r.id,
            version: r.version,
            payload: r.row ?? {},
          })),
          page.has_more
            ? { entity_index: idx, after_id: page.next_after_id }
            : { entity_index: idx + 1, after_id: null },
        )

        afterId = page.next_after_id
        if (!page.has_more) {
          break
        }
      }
    }

    await applyFullResyncSnapshot(opts.db, {
      cycleId,
      snapshotVersion: session.snapshot_version,
      immediate: true,
    })

    const actualCounts = await countMasterEntities(opts.db, entities)
    if (!countsMatch(actualCounts, session.counts, entities)) {
      // Pages are read live, so rows can change while the cycle runs. The catch-up pull below re-reads
      // every row above `snapshot_version`, which converges the counts. A restart is not needed (and
      // `pull/full/start` is limited to 1/hour/device, so it would only be rejected with 429).
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
      snapshotVersion: session.snapshot_version,
      serverTimeMs: catchUp.kind === 'ok' ? catchUp.serverTimeMs : undefined,
    }
  } catch {
    // Keep the staged rows and the pointer: the next call resumes (or discards the cycle once expired).
    return { kind: 'failed' }
  }
}
