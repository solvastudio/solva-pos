import {
  countCatalogSkus,
  countVisibleSkusAtOutlet,
  createCatalogScanDeps,
  findByBarcode,
  getPrice,
  searchProducts,
  type CatalogProductEntry,
} from '~/pos/data/catalog.repo'
import { featureEnabled } from '~/pos/data/feature-flag.repo'
import { getMeta } from '~/pos/data/meta.repo'
import { getOutboxQueueSummary } from '~/pos/data/outbox.repo'
import { stagePullRows } from '~/pos/data/pull-stage.repo'
import type { SolvaDb } from '~/pos/db/solva-db'
import type { MetaKey, MetaValueMap } from '~/pos/db/types'
import { getGlobalSyncStore, type SyncController } from '~/pos/sync'
import { applyPullCycle } from '~/pos/sync/applier'
import {
  resolveScan,
  type BarcodeMatch,
  type ScanResult,
} from '~/pos/usecases/catalog/resolve-scan'
import { enqueueAudit, type EnqueueAuditInput } from '~/pos/usecases/audit/enqueue-audit'
import type { PriceResolution } from '~/modules/catalog/shared'

export const E2E_HOOKS_MARKER = '__solva_e2e_hooks_marker__'

export interface BenchStagedRow {
  entity: string
  op: 'upsert' | 'delete'
  id: string
  version: number
  payload: Record<string, unknown>
}

export interface SolvaE2eCatalogHandle {
  count: () => Promise<number>
  visibleCount: (outletId?: string) => Promise<number>
  findByBarcode: (barcode: string) => Promise<BarcodeMatch | null>
  searchProducts: (
    query: string,
    opts?: { outletId?: string; limit?: number; categoryId?: string },
  ) => Promise<CatalogProductEntry[]>
  resolveScan: (code: string, outletId?: string) => Promise<ScanResult>
  getPrice: (
    skuId: string,
    uomId: string,
    outletId?: string,
    isOpenPrice?: boolean,
  ) => Promise<PriceResolution>
  benchmarkApplyRows: (rows: readonly BenchStagedRow[]) => Promise<{ durationMs: number }>
}

export interface SolvaE2eHandle {
  marker: string
  db: SolvaDb
  enqueueAudit: (input: EnqueueAuditInput) => ReturnType<typeof enqueueAudit>
  kickSync: () => void
  getSyncState: () => ReturnType<ReturnType<typeof getGlobalSyncStore>['getState']>
  getMeta: <K extends MetaKey>(key: K) => Promise<MetaValueMap[K] | null>
  getOutboxSummary: () => ReturnType<typeof getOutboxQueueSummary>
  runFullResync: () => Promise<'OK' | 'FAILED'>
  featureEnabled: (key: string) => Promise<boolean>
  catalog: SolvaE2eCatalogHandle
}

declare global {
  interface Window {
    __solva?: SolvaE2eHandle
  }
}

async function resolveDeviceOutlet(db: SolvaDb, explicitOutletId?: string): Promise<string> {
  if (explicitOutletId) return explicitOutletId
  const dev = await getMeta(db, 'device')
  if (!dev?.outlet_id) {
    throw new Error('Device meta outlet_id is not set')
  }
  return dev.outlet_id
}

export function installE2eHooks(opts: {
  db: SolvaDb
  getController: () => SyncController | null
}): void {
  if (typeof window === 'undefined') return
  const scanDeps = createCatalogScanDeps(opts.db)

  window.__solva = {
    marker: E2E_HOOKS_MARKER,
    db: opts.db,
    enqueueAudit: (input) => enqueueAudit(opts.db, input),
    kickSync: () => {
      opts.getController()?.kick('manual')
    },
    getSyncState: () => getGlobalSyncStore().getState(),
    getMeta: (key) => getMeta(opts.db, key),
    getOutboxSummary: () => getOutboxQueueSummary(opts.db),
    runFullResync: async () => {
      const ctrl = opts.getController()
      if (!ctrl) return 'FAILED'
      return ctrl.runFullResync()
    },
    featureEnabled: (key) => featureEnabled(opts.db, key),
    catalog: {
      count: () => countCatalogSkus(opts.db),
      visibleCount: (outletId) => countVisibleSkusAtOutlet(opts.db, outletId),
      findByBarcode: (barcode) => findByBarcode(opts.db, barcode),
      searchProducts: async (query, searchOpts) => {
        const outletId = await resolveDeviceOutlet(opts.db, searchOpts?.outletId)
        return searchProducts(opts.db, query, {
          outletId,
          limit: searchOpts?.limit,
          categoryId: searchOpts?.categoryId,
        })
      },
      resolveScan: async (code, outletId) => {
        const resolvedOutlet = await resolveDeviceOutlet(opts.db, outletId)
        return resolveScan(code, resolvedOutlet, scanDeps)
      },
      getPrice: async (skuId, uomId, outletId, isOpenPrice = false) => {
        const resolvedOutlet = await resolveDeviceOutlet(opts.db, outletId)
        return getPrice(opts.db, skuId, uomId, resolvedOutlet, isOpenPrice)
      },
      benchmarkApplyRows: async (rows) => {
        const cycleId = `bench-${Date.now()}`
        const chunk = 5_000
        for (let i = 0; i < rows.length; i += chunk) {
          await stagePullRows(
            opts.db,
            rows.slice(i, i + chunk).map((r) => ({
              cycle_id: cycleId,
              entity: r.entity,
              op: r.op,
              id: r.id,
              version: r.version,
              payload: r.payload,
            })),
          )
        }
        const curCursor = await getMeta(opts.db, 'catalog_cursor')
        const nextCursor = (curCursor ?? 0) + 1
        const t0 = performance.now()
        await applyPullCycle(opts.db, {
          cycleId,
          finalCursor: {
            version: nextCursor,
            id: '00000000-0000-0000-0000-000000000000',
          },
          catalogCursor: nextCursor,
          immediate: true,
        })
        return { durationMs: performance.now() - t0 }
      },
    },
  }
}
