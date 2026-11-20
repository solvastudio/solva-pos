import { effectiveAvailability, type PriceResolution } from '~/modules/catalog/shared'
import type {
  ItemOutletAvailabilityRecord,
  ProductRecord,
  SkuRecord,
  SkuUomRecord,
} from '../../db/types'

export type ScanResult =
  | {
      kind: 'FOUND'
      skuId: string
      uomId: string
      productId: string
      name: string
      variantLabel: string | null
      conversionFactor: string
      price: PriceResolution
    }
  | { kind: 'UNKNOWN_BARCODE' }
  | { kind: 'UNAVAILABLE_AT_OUTLET'; productName: string }
  | { kind: 'NO_PRICE'; productName: string }
  | { kind: 'INACTIVE'; productName: string }

export interface BarcodeMatch {
  skuUom: SkuUomRecord
  sku: SkuRecord
  product: ProductRecord
}

export interface ScanLookupDeps {
  findByBarcode: (barcode: string) => Promise<BarcodeMatch | null>
  getAvailabilityRows: (productId: string) => Promise<readonly ItemOutletAvailabilityRecord[]>
  getPrice: (
    skuId: string,
    uomId: string,
    outletId: string,
    isOpenPrice: boolean,
  ) => Promise<PriceResolution>
}

export interface SearchLookupDeps {
  searchProducts: (
    query: string,
    opts: { outletId: string; limit?: number; categoryId?: string },
  ) => Promise<readonly { product: ProductRecord; skus: readonly SkuRecord[] }[]>
  getPrice: (
    skuId: string,
    uomId: string,
    outletId: string,
    isOpenPrice: boolean,
  ) => Promise<PriceResolution>
}

export interface ResolvedSearchItem {
  product: ProductRecord
  sku: SkuRecord
  price: PriceResolution
}

/**
 * Pure barcode scan resolution (BR-CAT-004, BR-CAT-010, BR-CAT-015, BR-PRC-002):
 * 1) Barcode missing in `sku_uom` -> `UNKNOWN_BARCODE`
 * 2) Product or SKU globally inactive (`is_active = false`) -> `UNAVAILABLE_AT_OUTLET`
 *    (BR-CAT-004/015: same user-facing message as outlet-unavailable)
 * 3) Effective availability `UNAVAILABLE` at outlet -> `UNAVAILABLE_AT_OUTLET` with `product.name`
 * 4) Price `NO_PRICE` (non-open-price) -> `NO_PRICE` with `product.name`
 * 5) Open price without master price -> `FOUND` with `price.kind === 'OPEN_PRICE'`
 */
export async function resolveScan(
  code: string,
  outletId: string,
  deps: ScanLookupDeps,
): Promise<ScanResult> {
  const trimmed = code.trim()
  if (trimmed.length === 0) {
    return { kind: 'UNKNOWN_BARCODE' }
  }

  const match = await deps.findByBarcode(trimmed)
  if (!match) {
    return { kind: 'UNKNOWN_BARCODE' }
  }

  const { skuUom, sku, product } = match
  if (
    skuUom.deleted_at ||
    sku.deleted_at ||
    product.deleted_at ||
    !product.is_active ||
    !sku.is_active
  ) {
    return { kind: 'UNAVAILABLE_AT_OUTLET', productName: product.name }
  }

  const availRows = await deps.getAvailabilityRows(product.id)
  const productRow = availRows.find(
    (r) => !r.deleted_at && (!r.outlet_id || r.outlet_id === outletId) && (r.sku_id === null || r.sku_id === undefined),
  )
  const skuOverride = availRows.find(
    (r) => !r.deleted_at && (!r.outlet_id || r.outlet_id === outletId) && r.sku_id === sku.id,
  )

  const available = effectiveAvailability({
    productActive: Boolean(product.is_active),
    skuActive: Boolean(sku.is_active),
    productRow: productRow
      ? { productId: product.id, skuId: null, status: productRow.status }
      : undefined,
    skuOverride: skuOverride
      ? { productId: product.id, skuId: sku.id, status: skuOverride.status }
      : undefined,
  })

  if (!available) {
    return { kind: 'UNAVAILABLE_AT_OUTLET', productName: product.name }
  }

  const price = await deps.getPrice(
    sku.id,
    skuUom.uom_id,
    outletId,
    Boolean(product.is_open_price),
  )
  if (price.kind === 'NO_PRICE') {
    return { kind: 'NO_PRICE', productName: product.name }
  }

  return {
    kind: 'FOUND',
    skuId: sku.id,
    uomId: skuUom.uom_id,
    productId: product.id,
    name: product.name,
    variantLabel: sku.variant_label ?? null,
    conversionFactor: skuUom.conversion_factor,
    price,
  }
}

/**
 * Resolves offline product search results with per-SKU base UOM prices for selection UIs.
 */
export async function resolveSearch(
  query: string,
  opts: { outletId: string; limit?: number; categoryId?: string },
  deps: SearchLookupDeps,
): Promise<ResolvedSearchItem[]> {
  const products = await deps.searchProducts(query, opts)
  const out: ResolvedSearchItem[] = []

  for (const entry of products) {
    const firstSku = entry.skus[0]
    if (!firstSku) continue
    const price = await deps.getPrice(
      firstSku.id,
      entry.product.base_uom_id,
      opts.outletId,
      Boolean(entry.product.is_open_price),
    )
    out.push({
      product: entry.product,
      sku: firstSku,
      price,
    })
  }

  return out
}
