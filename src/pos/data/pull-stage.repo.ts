import type { Transaction } from 'dexie'
import { MASTER_STORE_NAMES } from '../db/schema-v1'
import type { SolvaDb } from '../db/solva-db'
import type { MetaValueMap, PullStageRow } from '../db/types'
import { getMeta, setMeta } from './meta.repo'

/**
 * How long a persisted full-resync cycle may be resumed. The server signs the snapshot token with a
 * 30-minute TTL (`SNAPSHOT_TOKEN_TTL_MS`); stay 5 minutes below it so a resume never meets an expired token.
 */
export const FULL_RESYNC_RESUME_WINDOW_MS = 25 * 60 * 1000

export type FullResyncStageMeta = NonNullable<MetaValueMap['full_resync_stage']>

/** A cycle is resumable while its snapshot token is certainly valid; a device clock that went backwards counts as expired. */
export function isFullResyncStageResumable(stage: FullResyncStageMeta, nowMs: number): boolean {
  const ageMs = nowMs - stage.started_at_ms
  return ageMs >= 0 && ageMs < FULL_RESYNC_RESUME_WINDOW_MS
}

export async function stagePullRows(
  db: SolvaDb,
  rows: readonly Omit<PullStageRow, 'seq'>[],
): Promise<void> {
  if (rows.length === 0) return
  await db.pull_stage.bulkAdd([...rows])
}

export async function readPullStageForCycle(
  db: SolvaDb,
  cycleId: string,
): Promise<PullStageRow[]> {
  return db.pull_stage.where('cycle_id').equals(cycleId).sortBy('seq')
}

export async function clearPullStageCycle(db: SolvaDb, cycleId?: string): Promise<void> {
  if (cycleId) {
    await db.pull_stage.where('cycle_id').equals(cycleId).delete()
    return
  }
  await db.pull_stage.clear()
}

/**
 * Stages one full-resync page and moves the resume pointer in the same transaction, so a crash can
 * never leave staged rows without a matching pointer (or the other way around).
 */
export async function stageFullResyncPage(
  db: SolvaDb,
  rows: readonly Omit<PullStageRow, 'seq'>[],
  pointer: Pick<FullResyncStageMeta, 'entity_index' | 'after_id'>,
): Promise<void> {
  await db.transaction('rw', db.pull_stage, db.meta, async (tx) => {
    const current = await getMeta(tx, 'full_resync_stage')
    if (!current) {
      throw new Error('stageFullResyncPage called without an active full-resync stage')
    }
    if (rows.length > 0) {
      await tx.table<PullStageRow, number>('pull_stage').bulkAdd([...rows])
    }
    await setMeta(tx, 'full_resync_stage', { ...current, ...pointer })
  })
}

/** Drops the staged rows and the resume pointer of a full-resync cycle (expired or abandoned). */
export async function discardFullResyncStage(db: SolvaDb, cycleId: string): Promise<void> {
  await db.transaction('rw', db.pull_stage, db.meta, async (tx) => {
    await tx.table<PullStageRow, number>('pull_stage').where('cycle_id').equals(cycleId).delete()
    await setMeta(tx, 'full_resync_stage', null)
  })
}

/**
 * Executes an atomic `rw` transaction covering `meta`, `pull_stage`, and all 24 master tables
 * so `applier.ts` never references `db.<store>` directly (preserving `pos-data-guard`).
 */
export async function runAtomicPullApplyTx(
  db: SolvaDb,
  fn: (tx: Transaction) => Promise<void>,
): Promise<void> {
  const tables = [
    db.meta,
    db.pull_stage,
    ...MASTER_STORE_NAMES.map((name) => db.table(name)),
  ]
  await db.transaction('rw', tables, (tx) => fn(tx))
}
