import Dexie from 'dexie'
import { toMoney } from '~/lib/kernel'
import {
  resolvePrice,
  type PriceEntryLike,
  type PriceResolution,
} from '~/modules/catalog/shared'
import { getCatalogAvailabilityIndex } from '../db/catalog-index'
import type { SolvaDb } from '../db/solva-db'
import type {
  ItemOutletAvailabilityRecord,
  ProductRecord,
  SkuRecord,
  SkuUomRecord,
  StockSnapshotRecord,
} from '../db/types'
import { getMeta } from './meta.repo'
import type { BarcodeMatch, ScanLookupDeps } from '../usecases/catalog/resolve-scan'

export interface CatalogProductEntry {
  product: ProductRecord
  skus: SkuRecord[]
}

/**
 * Looks up a SKU + product by exact barcode via the unique `&barcode` Dexie index (<= 50ms).
 */
export async function findByBarcode(
  db: SolvaDb,
  barcode: string,
): Promise<BarcodeMatch | null> {
  const trimmed = barcode.trim()
  if (trimmed.length === 0) {
    return null
  }

  const skuUom = await db.sku_uom.where('barcode').equals(trimmed).first()
  if (!skuUom || skuUom.deleted_at) {
    return null
  }

  const sku = await db.sku.get(skuUom.sku_id)
  if (!sku) {
    return null
  }
  const product = await db.product.get(sku.product_id)
  if (!product) {
    return null
  }

  return { skuUom, sku, product }
}

/**
 * Resolves unit selling price from Dexie `[sku_id+uom_id+outlet_key]` index
 * (`outletId` then tenant default `'*'`), delegating to shared `resolvePrice` (BR-PRC-001/002).
 */
export async function getPrice(
  db: SolvaDb,
  skuId: string,
  uomId: string,
  outletId: string,
  isOpenPrice = false,
): Promise<PriceResolution> {
  const [outletEntry, defaultEntry] = await Promise.all([
    db.price_entry
      .where('[sku_id+uom_id+outlet_key]')
      .equals([skuId, uomId, outletId])
      .first(),
    db.price_entry
      .where('[sku_id+uom_id+outlet_key]')
      .equals([skuId, uomId, '*'])
      .first(),
  ])

  const entries: PriceEntryLike[] = []
  if (outletEntry && !outletEntry.deleted_at) {
    entries.push({
      skuId: outletEntry.sku_id,
      uomId: outletEntry.uom_id,
      outletId: outletEntry.outlet_id,
      price: toMoney(Number(outletEntry.price)),
    })
  }
  if (defaultEntry && !defaultEntry.deleted_at) {
    entries.push({
      skuId: defaultEntry.sku_id,
      uomId: defaultEntry.uom_id,
      outletId: null,
      price: toMoney(Number(defaultEntry.price)),
    })
  }

  return resolvePrice({
    skuId,
    uomId,
    outletId,
    entries,
    isOpenPrice,
  })
}

export async function getAvailabilityRows(
  db: SolvaDb,
  productId: string,
): Promise<ItemOutletAvailabilityRecord[]> {
  const rows = await db.item_outlet_availability
    .where('[product_id+sku_key]')
    .between([productId, Dexie.minKey], [productId, Dexie.maxKey])
    .toArray()
  return rows.filter((r) => !r.deleted_at)
}

function tokenizeQuery(query: string): string[] {
  const folded = query
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
  const parts = folded
    .split(/[^a-z0-9._-]+/g)
    .map((t) => t.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((t) => t.length > 0)
  return [...new Set(parts)]
}

function hydrateAvailableProducts(
  products: readonly ProductRecord[],
  skus: readonly SkuRecord[],
  availMap: ReadonlyMap<string, boolean>,
): CatalogProductEntry[] {
  const skusByProduct = new Map<string, SkuRecord[]>()
  for (const s of skus) {
    if (s.deleted_at || !s.is_active) continue
    if (availMap.get(s.id) !== true) continue
    const list = skusByProduct.get(s.product_id) ?? []
    list.push(s)
    skusByProduct.set(s.product_id, list)
  }

  const out: CatalogProductEntry[] = []
  for (const p of products) {
    const visibleSkus = skusByProduct.get(p.id)
    if (!visibleSkus || visibleSkus.length === 0) continue
    visibleSkus.sort((a, b) => a.sort_order - b.sort_order || a.sku_code.localeCompare(b.sku_code))
    out.push({ product: p, skus: visibleSkus })
  }
  return out
}

/**
 * Searches active outlet-visible products offline via Dexie multiEntry `search_tokens` index
 * and in-memory effective availability index (<= 150ms p95 at 5,000 SKUs).
 */
export async function searchProducts(
  db: SolvaDb,
  query: string,
  opts: { outletId: string; limit?: number; categoryId?: string },
): Promise<CatalogProductEntry[]> {
  const limit = opts.limit ?? 50
  const trimmed = query.trim()
  const tokens = tokenizeQuery(trimmed)
  if (tokens.length === 0) {
    return []
  }

  // Order longest token first to minimize Dexie index scan cardinality.
  const orderedTokens = [...tokens].sort((a, b) => b.length - a.length)
  let candidateIds: Set<string> | null = null

  for (const token of orderedTokens) {
    const keys = (await db.product
      .where('search_tokens')
      .startsWith(token)
      .primaryKeys()) as string[]
    const unique = new Set(keys)
    if (candidateIds === null) {
      candidateIds = unique
    } else {
      const next = new Set<string>()
      for (const id of unique) {
        if (candidateIds.has(id)) next.add(id)
      }
      candidateIds = next
    }
    if (candidateIds.size === 0) {
      break
    }
  }

  const exactCodeRows = await db.product.where('code').equals(trimmed).primaryKeys()
  for (const id of exactCodeRows as string[]) {
    candidateIds = candidateIds ?? new Set()
    candidateIds.add(id)
  }

  if (!candidateIds || candidateIds.size === 0) {
    return []
  }

  const [rawProducts, availMap] = await Promise.all([
    db.product.bulkGet([...candidateIds]),
    getCatalogAvailabilityIndex(db, opts.outletId),
  ])

  const activeProducts = rawProducts.filter(
    (p): p is ProductRecord =>
      Boolean(p) &&
      !p!.deleted_at &&
      Boolean(p!.is_active) &&
      (!opts.categoryId || p!.category_id === opts.categoryId),
  )
  if (activeProducts.length === 0) {
    return []
  }

  const trimmedLower = trimmed.toLowerCase()
  activeProducts.sort((a, b) => {
    const aExact = a.code.toLowerCase() === trimmedLower ? 0 : 1
    const bExact = b.code.toLowerCase() === trimmedLower ? 0 : 1
    if (aExact !== bExact) return aExact - bExact
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.name.localeCompare(b.name)
  })

  const batchSize = Math.max(limit * 2, 60)
  const out: CatalogProductEntry[] = []
  for (let offset = 0; offset < activeProducts.length && out.length < limit; offset += batchSize) {
    const slice = activeProducts.slice(offset, offset + batchSize)
    const skus = await db.sku
      .where('product_id')
      .anyOf(slice.map((p) => p.id))
      .toArray()
    out.push(...hydrateAvailableProducts(slice, skus, availMap))
  }
  return out.slice(0, limit)
}

/**
 * Returns paginated active outlet-visible products for category grid views (Phase 44).
 */
export async function listVisibleProducts(
  db: SolvaDb,
  opts: { outletId: string; categoryId?: string; page?: number; pageSize?: number },
): Promise<{ items: CatalogProductEntry[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.max(1, opts.pageSize ?? 50)

  const [products, availMap] = await Promise.all([
    opts.categoryId
      ? db.product.where('category_id').equals(opts.categoryId).toArray()
      : db.product.toArray(),
    getCatalogAvailabilityIndex(db, opts.outletId),
  ])

  const activeProducts = products.filter((p) => !p.deleted_at && Boolean(p.is_active))
  activeProducts.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

  const skus =
    activeProducts.length > 0
      ? await db.sku
          .where('product_id')
          .anyOf(activeProducts.map((p) => p.id))
          .toArray()
      : []

  const allVisible = hydrateAvailableProducts(activeProducts, skus, availMap)
  const start = (page - 1) * pageSize
  return {
    items: allVisible.slice(start, start + pageSize),
    total: allVisible.length,
    page,
    pageSize,
  }
}

export async function countCatalogSkus(db: SolvaDb): Promise<number> {
  const skus = await db.sku.toArray()
  return skus.filter((s) => !s.deleted_at).length
}

export async function countVisibleSkusAtOutlet(
  db: SolvaDb,
  outletId?: string,
): Promise<number> {
  const targetOutlet = outletId ?? (await getMeta(db, 'device'))?.outlet_id
  if (!targetOutlet) return 0
  const availMap = await getCatalogAvailabilityIndex(db, targetOutlet)
  let count = 0
  for (const visible of availMap.values()) {
    if (visible) count += 1
  }
  return count
}

export function createCatalogScanDeps(db: SolvaDb): ScanLookupDeps {
  return {
    findByBarcode: (barcode) => findByBarcode(db, barcode),
    getAvailabilityRows: (productId) => getAvailabilityRows(db, productId),
    getPrice: (skuId, uomId, outletId, isOpenPrice) =>
      getPrice(db, skuId, uomId, outletId, isOpenPrice),
  }
}

export async function listSkuUomsForSku(db: SolvaDb, skuId: string): Promise<SkuUomRecord[]> {
  const rows = await db.sku_uom.where('sku_id').equals(skuId).toArray()
  return rows.filter((r) => !r.deleted_at)
}

export async function listAllSkuUoms(db: SolvaDb): Promise<SkuUomRecord[]> {
  const rows = await db.sku_uom.toArray()
  return rows.filter((r) => !r.deleted_at)
}

export async function getStockSnapshotsMap(
  db: SolvaDb,
  skuIds?: readonly string[],
): Promise<Map<string, StockSnapshotRecord>> {
  const rows = skuIds
    ? await db.stock_snapshot.where('sku_id').anyOf([...skuIds]).toArray()
    : await db.stock_snapshot.toArray()
  const map = new Map<string, StockSnapshotRecord>()
  for (const row of rows) {
    map.set(row.sku_id, row)
  }
  return map
}

export async function listAllVisibleProducts(
  db: SolvaDb,
  outletId: string,
): Promise<CatalogProductEntry[]> {
  const result = await listVisibleProducts(db, { outletId, page: 1, pageSize: Number.MAX_SAFE_INTEGER })
  return result.items
}

export async function listOutletPricesForProducts(
  db: SolvaDb,
  outletId: string,
): Promise<Map<string, PriceResolution>> {
  const allEntries = await db.price_entry.toArray()
  const byKey = new Map<string, PriceEntryLike[]>()
  for (const row of allEntries) {
    if (row.deleted_at) continue
    if (row.outlet_id !== null && row.outlet_id !== outletId) continue
    const key = `${row.sku_id}::${row.uom_id}`
    const list = byKey.get(key)
    const entry: PriceEntryLike = {
      skuId: row.sku_id,
      uomId: row.uom_id,
      outletId: row.outlet_id,
      price: toMoney(Number(row.price)),
    }
    if (list) list.push(entry)
    else byKey.set(key, [entry])
  }
  const resolved = new Map<string, PriceResolution>()
  for (const [key, list] of byKey.entries()) {
    const first = list[0]!
    const res = resolvePrice({
      skuId: first.skuId,
      uomId: first.uomId,
      outletId,
      entries: list,
      isOpenPrice: false,
    })
    resolved.set(key, res)
  }
  return resolved
}
