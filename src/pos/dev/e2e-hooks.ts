import { getMeta } from '~/pos/data/meta.repo'
import type { MetaKey, MetaValueMap } from '~/pos/db/types'
import type { SolvaDb } from '~/pos/db/solva-db'
import { getGlobalSyncStore, type SyncController } from '~/pos/sync'
import { enqueueAudit, type EnqueueAuditInput } from '~/pos/usecases/audit/enqueue-audit'

export const E2E_HOOKS_MARKER = '__solva_e2e_hooks_marker__'

export interface SolvaE2eHandle {
  marker: string
  db: SolvaDb
  enqueueAudit: (input: EnqueueAuditInput) => ReturnType<typeof enqueueAudit>
  kickSync: () => void
  getSyncState: () => ReturnType<ReturnType<typeof getGlobalSyncStore>['getState']>
  getMeta: <K extends MetaKey>(key: K) => Promise<MetaValueMap[K] | null>
  runFullResync: () => Promise<'OK' | 'FAILED'>
}

declare global {
  interface Window {
    __solva?: SolvaE2eHandle
  }
}

export function installE2eHooks(opts: {
  db: SolvaDb
  getController: () => SyncController | null
}): void {
  if (typeof window === 'undefined') return
  window.__solva = {
    marker: E2E_HOOKS_MARKER,
    db: opts.db,
    enqueueAudit: (input) => enqueueAudit(opts.db, input),
    kickSync: () => {
      opts.getController()?.kick('manual')
    },
    getSyncState: () => getGlobalSyncStore().getState(),
    getMeta: (key) => getMeta(opts.db, key),
    runFullResync: async () => {
      const ctrl = opts.getController()
      if (!ctrl) return 'FAILED'
      return ctrl.runFullResync()
    },
  }
}
