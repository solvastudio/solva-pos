export type AvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE'

export interface AvailabilityRow {
  productId: string
  skuId: string | null
  status: AvailabilityStatus
  deleted?: boolean
}

export interface AvailabilityProductLike {
  id: string
  isActive: boolean
  deleted?: boolean
}

export interface AvailabilitySkuLike {
  id: string
  productId: string
  isActive: boolean
  deleted?: boolean
}

/**
 * Evaluates effective item availability at an outlet (BR-CAT-010/016, V-27):
 * 1) Global inactive product or SKU always loses -> `false`
 * 2) Active (non-tombstoned) SKU override wins two-way -> `status === 'AVAILABLE'`
 * 3) Active (non-tombstoned) product-level row -> `status === 'AVAILABLE'`
 * 4) Otherwise defaults to `true` (e.g. pull not yet complete)
 */
export function effectiveAvailability(input: {
  productActive: boolean
  skuActive: boolean
  productRow?: AvailabilityRow
  skuOverride?: AvailabilityRow
}): boolean {
  if (!input.productActive || !input.skuActive) {
    return false
  }
  if (input.skuOverride && !input.skuOverride.deleted) {
    return input.skuOverride.status === 'AVAILABLE'
  }
  if (input.productRow && !input.productRow.deleted) {
    return input.productRow.status === 'AVAILABLE'
  }
  return true
}

function buildAvailabilityLookup(rows: readonly AvailabilityRow[]): {
  productRows: Map<string, AvailabilityRow>
  skuOverrides: Map<string, AvailabilityRow>
} {
  const productRows = new Map<string, AvailabilityRow>()
  const skuOverrides = new Map<string, AvailabilityRow>()

  for (const row of rows) {
    if (row.deleted) continue
    if (row.skuId === null) {
      productRows.set(row.productId, row)
    } else {
      skuOverrides.set(`${row.productId}:${row.skuId}`, row)
    }
  }

  return { productRows, skuOverrides }
}

/**
 * Filters active SKUs visible at an outlet given its availability rows.
 */
export function visibleSkusForOutlet<
  P extends AvailabilityProductLike,
  S extends AvailabilitySkuLike,
>(products: readonly P[], skus: readonly S[], rows: readonly AvailabilityRow[]): S[] {
  const productMap = new Map<string, P>()
  for (const p of products) {
    if (!p.deleted) {
      productMap.set(p.id, p)
    }
  }

  const { productRows, skuOverrides } = buildAvailabilityLookup(rows)
  const visible: S[] = []

  for (const sku of skus) {
    if (sku.deleted) continue
    const product = productMap.get(sku.productId)
    if (!product) continue

    const isAvail = effectiveAvailability({
      productActive: product.isActive,
      skuActive: sku.isActive,
      productRow: productRows.get(product.id),
      skuOverride: skuOverrides.get(`${product.id}:${sku.id}`),
    })
    if (isAvail) {
      visible.push(sku)
    }
  }

  return visible
}

/**
 * Returns `true` when at least one SKU of `product` is effectively available at the outlet.
 */
export function productVisible<
  P extends AvailabilityProductLike,
  S extends AvailabilitySkuLike,
>(product: P, skus: readonly S[], rows: readonly AvailabilityRow[]): boolean {
  return visibleSkusForOutlet([product], skus, rows).length > 0
}
