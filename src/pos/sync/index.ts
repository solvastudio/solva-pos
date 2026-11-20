import { getMeta } from '../data/meta.repo'
import type { SolvaDb } from '../db/solva-db'
import { createSyncClock } from './clock'
import { runFullResync } from './full-resync'

export {
  getGlobalSyncStore,
  kickActiveSync,
  startSyncEngine,
  type SyncController,
} from './engine'
export type { DerivedSyncIndicator, SyncBannerItem, SyncState } from './sync-state'
export { deriveSyncIndicator } from './sync-state'

export interface InitialSyncProgress {
  step: number
  total: number
  label: string
}

export interface InitialSyncHandle {
  subscribe(listener: (progress: InitialSyncProgress) => void): () => void
  done: Promise<'OK' | 'FAILED'>
}

/**
 * Executes real initial full-resync immediately after pairing completion
 * so master tables (outlets, registers, roles, staff) are populated offline-ready.
 */
export function startInitialSync(
  db: SolvaDb,
  deps?: { fetch?: typeof fetch },
): InitialSyncHandle {
  const listeners = new Set<(p: InitialSyncProgress) => void>()
  let latest: InitialSyncProgress = { step: 0, total: 1, label: 'starting' }

  const done = (async (): Promise<'OK' | 'FAILED'> => {
    const clockMeta = await getMeta(db, 'clock')
    const clock = createSyncClock({ db, initialMeta: clockMeta })
    const res = await runFullResync({
      db,
      clock,
      fetch: deps?.fetch,
      onProgress: (p) => {
        latest = p
        for (const cb of listeners) {
          cb(p)
        }
      },
    })
    return res.kind === 'ok' ? 'OK' : 'FAILED'
  })()

  return {
    subscribe(listener) {
      listeners.add(listener)
      listener(latest)
      return () => {
        listeners.delete(listener)
      }
    },
    done,
  }
}
