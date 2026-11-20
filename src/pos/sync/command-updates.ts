import type { PullCommandUpdate } from '~/lib/contracts'
import { applyCommandUpdatesInDb } from '../data/outbox.repo'
import type { SolvaDb } from '../db/solva-db'

/**
 * Applies manager decisions returned by server `/pull` (`command_updates`) inside a single
 * atomic Dexie transaction across `outbox_command` and local transaction stores:
 * - `ACCEPTED_MANUAL` / `ACKED` -> marks command `ACKED` and projects `SYNCED` onto the document.
 * - `DISMISSED` -> marks command `DISMISSED` (retained in history & pending export).
 * - `NEEDS_ATTENTION` -> updates status + optional server reason (e.g. `UNKNOWN_REFERENCE`, FLOW-18).
 */
export async function applyCommandUpdates(
  db: SolvaDb,
  updates: readonly PullCommandUpdate[],
  opts: { ackedAtIso: string },
): Promise<number> {
  return applyCommandUpdatesInDb(db, updates, opts)
}
