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
  return db.pull_stage.where('cycle_id').equals(cycleId).toArray()
}

export async function clearPullStageCycle(db: SolvaDb, cycleId?: string): Promise<void> {
  if (cycleId) {
    await db.pull_stage.where('cycle_id').equals(cycleId).delete()
    return
  }
  await db.pull_stage.clear()
}
