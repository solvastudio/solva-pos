import type { Transaction } from 'dexie'
import { MASTER_STORE_NAMES } from '../db/schema-v1'
import type { SolvaDb } from '../db/solva-db'
import type { PullStageRow } from '../db/types'

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
