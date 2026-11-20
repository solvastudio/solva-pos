import { effectiveAvailability, type AvailabilityRow } from '~/modules/catalog/shared'
import type { SolvaDb } from './solva-db'
import type { ItemOutletAvailabilityRecord, ProductRecord, SkuRecord } from './types'

interface CachedCatalogIndex {
  readonly cursor: number
  readonly builtAtMs: number
  readonly availableBySkuId: Map<string, boolean>
}

const catalogIndexCache = new Map<string, CachedCatalogIndex>()
const indexListeners = new Set<(event: { tenantId: string; outletId: string; cursor: number }) => void>()

function cacheKey(tenantId: string, outletId: string): string {
  return `${tenantId}:${outletId}`
}

async function readCatalogCursor(db: SolvaDb): Promise<number> {
  const row = await db.meta.get('catalog_cursor')
  return typeof row?.value === 'number' ? row.value : 0
}

async function resolveTargetOutletId(db: SolvaDb, outletId?: string): Promise<string | null> {
  if (outletId) return outletId
  const dev = await db.meta.get('device')
  const val = dev?.value as { outlet_id?: string } | undefined
  return val?.outlet_id ?? null
}

/**
 * Pure computation of effective availability map from loaded master rows.
 */
export function computeAvailabilityMap(
  outletId: string,
  products: readonly ProductRecord[],
  skus: readonly SkuRecord[],
  availRows: readonly ItemOutletAvailabilityRecord[],
): Map<string, boolean> {
  const productActiveMap = new Map<string, boolean>()
  for (let i = 0; i < products.length; i += 1) {
    const p = products[i]!
    if (!p.deleted_at) {
      productActiveMap.set(p.id, Boolean(p.is_active))
    }
  }

  const productAvailRows = new Map<string, AvailabilityRow>()
  const skuOverrideRows = new Map<string, AvailabilityRow>()
  for (let i = 0; i < availRows.length; i += 1) {
    const a = availRows[i]!
    if (a.deleted_at) continue
    if (a.outlet_id && a.outlet_id !== outletId) continue
    if (a.sku_id) {
      skuOverrideRows.set(a.sku_id, {
        productId: a.product_id,
        skuId: a.sku_id,
        status: a.status,
        deleted: false,
      })
    } else {
      productAvailRows.set(a.product_id, {
        productId: a.product_id,
        skuId: null,
        status: a.status,
        deleted: false,
      })
    }
  }

  const availableBySkuId = new Map<string, boolean>()
  for (let i = 0; i < skus.length; i += 1) {
    const s = skus[i]!
    if (s.deleted_at) continue
    const productActive = productActiveMap.get(s.product_id)
    if (productActive === undefined) {
      availableBySkuId.set(s.id, false)
      continue
    }
    const isAvail = effectiveAvailability({
      productActive,
      skuActive: Boolean(s.is_active),
      productRow: productAvailRows.get(s.product_id),
      skuOverride: skuOverrideRows.get(s.id),
    })
    availableBySkuId.set(s.id, isAvail)
  }

  return availableBySkuId
}

/**
 * Computes the in-memory `Map<skuId, boolean>` of effective availability for a device outlet
 * from Dexie master stores (`product`, `sku`, `item_outlet_availability`).
 */
export async function buildCatalogAvailabilityIndex(
  db: SolvaDb,
  outletId: string,
): Promise<Map<string, boolean>> {
  const [products, skus, availRows] = await db.transaction(
    'r',
    db.product,
    db.sku,
    db.item_outlet_availability,
    () => Promise.all([db.product.toArray(), db.sku.toArray(), db.item_outlet_availability.toArray()]),
  )

  return computeAvailabilityMap(outletId, products, skus, availRows)
}

/**
 * Rebuilds and caches effective SKU availability for the active outlet after applier commits.
 */
export async function rebuildCatalogAvailabilityIndex(
  db: SolvaDb,
  outletId?: string,
): Promise<Map<string, boolean>> {
  const resolvedOutlet = await resolveTargetOutletId(db, outletId)
  if (!resolvedOutlet) {
    return new Map()
  }
  const [cursor, availableBySkuId] = await Promise.all([
    readCatalogCursor(db),
    buildCatalogAvailabilityIndex(db, resolvedOutlet),
  ])
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  catalogIndexCache.set(cacheKey(db.tenantId, resolvedOutlet), {
    cursor,
    builtAtMs: now,
    availableBySkuId,
  })
  for (const listener of indexListeners) {
    listener({ tenantId: db.tenantId, outletId: resolvedOutlet, cursor })
  }
  return availableBySkuId
}

/**
 * Returns cached effective availability map for `(tenantId, outletId)` if `meta.catalog_cursor`
 * matches, otherwise builds and caches it on demand.
 */
export async function getCatalogAvailabilityIndex(
  db: SolvaDb,
  outletId: string,
): Promise<Map<string, boolean>> {
  const cursor = await readCatalogCursor(db)
  const key = cacheKey(db.tenantId, outletId)
  const cached = catalogIndexCache.get(key)
  if (cached && cursor > 0 && cached.cursor === cursor) {
    return cached.availableBySkuId
  }
  const availableBySkuId = await buildCatalogAvailabilityIndex(db, outletId)
  if (cursor > 0) {
    catalogIndexCache.set(key, {
      cursor,
      builtAtMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      availableBySkuId,
    })
  }
  return availableBySkuId
}

export function subscribeCatalogIndex(
  cb: (event: { tenantId: string; outletId: string; cursor: number }) => void,
): () => void {
  indexListeners.add(cb)
  return () => {
    indexListeners.delete(cb)
  }
}

export function clearCatalogIndexCache(tenantId?: string): void {
  if (!tenantId) {
    catalogIndexCache.clear()
    return
  }
  for (const key of catalogIndexCache.keys()) {
    if (key.startsWith(`${tenantId}:`)) {
      catalogIndexCache.delete(key)
    }
  }
}
