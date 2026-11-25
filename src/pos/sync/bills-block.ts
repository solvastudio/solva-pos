import type { BillsSnapshotBlock } from '~/lib/contracts'
import { applyBillsSnapshotBlock } from '../data/bill-snapshot.repo'
import type { SolvaDb } from '../db/solva-db'

/**
 * Applies the pull response's `bills` block atomically without failing the pull cycle on errors.
 */
export async function applyPulledBillsBlock(
  db: SolvaDb,
  block: BillsSnapshotBlock | 'unchanged' | undefined,
  currentDeviceId?: string,
): Promise<void> {
  if (!block || block === 'unchanged') {
    return
  }
  await applyBillsSnapshotBlock(db, block, currentDeviceId)
}
