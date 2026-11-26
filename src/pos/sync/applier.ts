import {
  applyMasterRows,
  clearMasterStoresInTx,
  type PullMasterRow,
} from '../data/master.repo'
import { getMeta, setMeta } from '../data/meta.repo'
import { runAtomicPullApplyTx } from '../data/pull-stage.repo'
import { rebuildCatalogAvailabilityIndex } from '../db/catalog-index'
import type { SolvaDb } from '../db/solva-db'
import type { PullStageRow } from '../db/types'

export const LARGE_INCREMENTAL_THRESHOLD = 60_000

const CATALOG_INDEX_ENTITIES = new Set([
  'category',
  'uom',
  'product',
  'sku',
  'sku_uom',
  'price_entry',
  'item_outlet_availability',
])

function runWhenIdle(immediate: boolean): Promise<void> {
  if (immediate) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    const g = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }
    if (typeof g.requestIdleCallback === 'function') {
      g.requestIdleCallback(() => resolve(), { timeout: 250 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

function toMasterRows(staged: readonly PullStageRow[]): PullMasterRow[] {
  return staged.map((s) => ({
    entity: s.entity,
    op: s.op,
    id: s.id,
    payload: s.payload,
  }))
}

/**
 * Atomically commits all staged incremental pull pages in a single Dexie `rw` transaction
 * (master stores + `pull_stage` + `meta`), guaranteeing zero partial states on screen.
 */
export async function applyPullCycle(
  db: SolvaDb,
  opts: {
    cycleId: string
    finalCursor: { version: number; id: string } | null
    catalogCursor: number
    immediate?: boolean
  },
): Promise<void> {
  await runWhenIdle(Boolean(opts.immediate))

  const prevCatalogCursor = (await getMeta(db, 'catalog_cursor')) ?? 0
  let catalogTouched = opts.catalogCursor !== prevCatalogCursor

  await runAtomicPullApplyTx(db, async (tx) => {
    const stageTable = tx.table<PullStageRow, number>('pull_stage')
    const staged = await stageTable.where('cycle_id').equals(opts.cycleId).toArray()
    staged.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

    if (staged.length > 0) {
      for (const s of staged) {
        if (CATALOG_INDEX_ENTITIES.has(s.entity)) {
          catalogTouched = true
          break
        }
      }
      await applyMasterRows(tx, toMasterRows(staged))
    }

    if (opts.finalCursor) {
      await setMeta(tx, 'cursor', opts.finalCursor)
    }
    await setMeta(tx, 'catalog_cursor', opts.catalogCursor)
    await setMeta(tx, 'stage', null)
    await stageTable.where('cycle_id').equals(opts.cycleId).delete()
  })

  if (catalogTouched) {
    await rebuildCatalogAvailabilityIndex(db).catch(() => {})
  }
}

/**
 * Atomically replaces all 24 master tables from staged full-resync pages without ever
 * touching `meta.device`, local transactions, `outbox_command`, `local_counter`, or `device_log`.
 */
export async function applyFullResyncSnapshot(
  db: SolvaDb,
  opts: {
    cycleId: string
    snapshotVersion: number
    immediate?: boolean
  },
): Promise<void> {
  await runWhenIdle(Boolean(opts.immediate))

  await runAtomicPullApplyTx(db, async (tx) => {
    const stageTable = tx.table<PullStageRow, number>('pull_stage')
    const staged = await stageTable.where('cycle_id').equals(opts.cycleId).toArray()
    staged.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

    await clearMasterStoresInTx(tx)

    if (staged.length > 0) {
      await applyMasterRows(tx, toMasterRows(staged))
    }

    await setMeta(tx, 'cursor', {
      version: opts.snapshotVersion,
      id: '00000000-0000-0000-0000-000000000000',
    })
    await setMeta(tx, 'catalog_cursor', opts.snapshotVersion)
    await setMeta(tx, 'snapshot_version', String(opts.snapshotVersion))
    await setMeta(tx, 'full_resync', false)
    await setMeta(tx, 'stage', null)
    await setMeta(tx, 'full_resync_stage', null)
    await stageTable.where('cycle_id').equals(opts.cycleId).delete()
  })

  await rebuildCatalogAvailabilityIndex(db).catch(() => {})
}
