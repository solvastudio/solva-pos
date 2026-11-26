import '@tanstack/react-start/server-only'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { ModifierAdjustType } from '~/lib/contracts'
import { toMoney } from '~/lib/kernel'
import type { TenantTx } from '~/server/db'
import { resolvePrice, type PriceEntryLike, type PriceResolution } from '../domain/price'
import type { AvailabilityStatus, ProductType } from '../shared'
import { chunkArray } from './chunk'
import { itemOutletAvailability, priceEntry, product, sku, uom } from './schema'
import { modifier, modifierIngredient, recipeItem } from './schema-fnb'

export async function getProductSkuState(
  tx: TenantTx,
  skuId: string,
): Promise<{
  productId: string
  productActive: boolean
  skuActive: boolean
  isOpenPrice: boolean
} | null> {
  const rows = await tx
    .select({
      productId: sku.productId,
      skuIsActive: sku.isActive,
      skuDeletedAt: sku.deletedAt,
      productIsActive: product.isActive,
      productDeletedAt: product.deletedAt,
      isOpenPrice: product.isOpenPrice,
    })
    .from(sku)
    .innerJoin(product, and(eq(product.tenantId, sku.tenantId), eq(product.id, sku.productId)))
    .where(eq(sku.id, skuId))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  return {
    productId: row.productId,
    productActive: row.productIsActive && row.productDeletedAt === null,
    skuActive: row.skuIsActive && row.skuDeletedAt === null,
    isOpenPrice: row.isOpenPrice,
  }
}

export async function getCurrentPrice(
  tx: TenantTx,
  params: { skuId: string; uomId: string; outletId: string },
): Promise<PriceResolution> {
  const state = await getProductSkuState(tx, params.skuId)
  const isOpenPrice = state?.isOpenPrice ?? false

  const entries = await tx
    .select({
      skuId: priceEntry.skuId,
      uomId: priceEntry.uomId,
      outletId: priceEntry.outletId,
      price: priceEntry.price,
    })
    .from(priceEntry)
    .where(
      and(
        eq(priceEntry.skuId, params.skuId),
        eq(priceEntry.uomId, params.uomId),
        isNull(priceEntry.deletedAt),
        or(eq(priceEntry.outletId, params.outletId), isNull(priceEntry.outletId)),
      ),
    )

  return resolvePrice({
    skuId: params.skuId,
    uomId: params.uomId,
    outletId: params.outletId,
    entries: entries.map((e) => ({
      skuId: e.skuId,
      uomId: e.uomId,
      outletId: e.outletId,
      price: toMoney(e.price),
    })),
    isOpenPrice,
  })
}

export async function getEffectiveAvailabilityRow(
  tx: TenantTx,
  params: { outletId: string; productId: string | null; skuId: string },
): Promise<{ status: AvailabilityStatus; version: number; changedAt: string } | null> {
  let effectiveProductId = params.productId
  if (!effectiveProductId) {
    const skuRows = await tx
      .select({ productId: sku.productId })
      .from(sku)
      .where(eq(sku.id, params.skuId))
      .limit(1)
    effectiveProductId = skuRows[0]?.productId ?? null
  }
  if (!effectiveProductId) return null

  const rows = await tx
    .select({
      skuId: itemOutletAvailability.skuId,
      status: itemOutletAvailability.status,
      version: itemOutletAvailability.version,
      changedAt: itemOutletAvailability.changedAt,
    })
    .from(itemOutletAvailability)
    .where(
      and(
        eq(itemOutletAvailability.outletId, params.outletId),
        eq(itemOutletAvailability.productId, effectiveProductId),
        isNull(itemOutletAvailability.deletedAt),
        or(eq(itemOutletAvailability.skuId, params.skuId), isNull(itemOutletAvailability.skuId)),
      ),
    )

  const override = rows.find((r) => r.skuId === params.skuId)
  const effective = override ?? rows.find((r) => r.skuId === null)
  if (!effective) return null

  return {
    status: effective.status as AvailabilityStatus,
    version: effective.version,
    changedAt: effective.changedAt,
  }
}

export interface ProductSkuState {
  productId: string
  productActive: boolean
  skuActive: boolean
  isOpenPrice: boolean
}

/**
 * Batch variant of `getProductSkuState`: one query for all SKUs.
 * SKUs that do not exist are absent from the returned map.
 */
export async function getProductSkuStates(
  tx: TenantTx,
  skuIds: readonly string[],
): Promise<Map<string, ProductSkuState>> {
  const out = new Map<string, ProductSkuState>()
  for (const batch of chunkArray([...new Set(skuIds)])) {
    const rows = await tx
      .select({
        skuId: sku.id,
        productId: sku.productId,
        skuIsActive: sku.isActive,
        skuDeletedAt: sku.deletedAt,
        productIsActive: product.isActive,
        productDeletedAt: product.deletedAt,
        isOpenPrice: product.isOpenPrice,
      })
      .from(sku)
      .innerJoin(product, and(eq(product.tenantId, sku.tenantId), eq(product.id, sku.productId)))
      .where(inArray(sku.id, batch))
    for (const row of rows) {
      out.set(row.skuId, {
        productId: row.productId,
        productActive: row.productIsActive && row.productDeletedAt === null,
        skuActive: row.skuIsActive && row.skuDeletedAt === null,
        isOpenPrice: row.isOpenPrice,
      })
    }
  }
  return out
}

/**
 * Batch variant of `getCurrentPrice`. The result is keyed by `${skuId}:${uomId}`.
 * `states` must come from `getProductSkuStates` for the same SKUs (used for the open-price flag).
 */
export async function getCurrentPrices(
  tx: TenantTx,
  params: {
    outletId: string
    pairs: ReadonlyArray<{ skuId: string; uomId: string }>
    states: ReadonlyMap<string, ProductSkuState>
  },
): Promise<Map<string, PriceResolution>> {
  const out = new Map<string, PriceResolution>()
  const entriesByKey = new Map<string, PriceEntryLike[]>()
  for (const batch of chunkArray([...new Set(params.pairs.map((p) => p.skuId))])) {
    const rows = await tx
      .select({
        skuId: priceEntry.skuId,
        uomId: priceEntry.uomId,
        outletId: priceEntry.outletId,
        price: priceEntry.price,
      })
      .from(priceEntry)
      .where(
        and(
          inArray(priceEntry.skuId, batch),
          isNull(priceEntry.deletedAt),
          or(eq(priceEntry.outletId, params.outletId), isNull(priceEntry.outletId)),
        ),
      )
    for (const r of rows) {
      const key = `${r.skuId}:${r.uomId}`
      const list = entriesByKey.get(key) ?? []
      list.push({ skuId: r.skuId, uomId: r.uomId, outletId: r.outletId, price: toMoney(r.price) })
      entriesByKey.set(key, list)
    }
  }
  for (const pair of params.pairs) {
    const key = `${pair.skuId}:${pair.uomId}`
    if (out.has(key)) continue
    out.set(
      key,
      resolvePrice({
        skuId: pair.skuId,
        uomId: pair.uomId,
        outletId: params.outletId,
        entries: entriesByKey.get(key) ?? [],
        isOpenPrice: params.states.get(pair.skuId)?.isOpenPrice ?? false,
      }),
    )
  }
  return out
}

export interface EffectiveAvailability {
  status: AvailabilityStatus
  version: number
  changedAt: string
}

/**
 * Batch variant of `getEffectiveAvailabilityRow`. The result is keyed by `${productId}:${skuId}`
 * where `productId` is the item's own product id, or the SKU's product id when the item has none.
 * A SKU-level override wins over the product-level row; no row means `null`.
 */
export async function getEffectiveAvailabilityRows(
  tx: TenantTx,
  params: {
    outletId: string
    items: ReadonlyArray<{ productId: string | null; skuId: string }>
    states: ReadonlyMap<string, ProductSkuState>
  },
): Promise<Map<string, EffectiveAvailability | null>> {
  const out = new Map<string, EffectiveAvailability | null>()
  const resolved: Array<{ key: string; productId: string; skuId: string }> = []
  for (const item of params.items) {
    const productId = item.productId ?? params.states.get(item.skuId)?.productId ?? null
    const key = `${productId}:${item.skuId}`
    if (productId === null) {
      out.set(key, null)
      continue
    }
    resolved.push({ key, productId, skuId: item.skuId })
  }

  const rows: Array<{
    productId: string
    skuId: string | null
    status: string
    version: number
    changedAt: string
  }> = []
  for (const batch of chunkArray([...new Set(resolved.map((r) => r.productId))])) {
    const found = await tx
      .select({
        productId: itemOutletAvailability.productId,
        skuId: itemOutletAvailability.skuId,
        status: itemOutletAvailability.status,
        version: itemOutletAvailability.version,
        changedAt: itemOutletAvailability.changedAt,
      })
      .from(itemOutletAvailability)
      .where(
        and(
          eq(itemOutletAvailability.outletId, params.outletId),
          inArray(itemOutletAvailability.productId, batch),
          isNull(itemOutletAvailability.deletedAt),
        ),
      )
    rows.push(...found)
  }

  for (const r of resolved) {
    const override = rows.find((x) => x.productId === r.productId && x.skuId === r.skuId)
    const effective = override ?? rows.find((x) => x.productId === r.productId && x.skuId === null)
    out.set(
      r.key,
      effective
        ? {
            status: effective.status as AvailabilityStatus,
            version: effective.version,
            changedAt: effective.changedAt,
          }
        : null,
    )
  }
  return out
}

export async function filterMissingCatalogRefs(
  tx: TenantTx,
  params: {
    tenantId: string
    skuIds: readonly string[]
    uomIds: readonly string[]
  },
): Promise<{ missingSkuId: string | null; missingUomId: string | null }> {
  const uniqueSkus = [...new Set(params.skuIds)]
  if (uniqueSkus.length > 0) {
    const foundSkus = await tx
      .select({ id: sku.id })
      .from(sku)
      .where(and(eq(sku.tenantId, params.tenantId), inArray(sku.id, uniqueSkus)))
    const skuSet = new Set(foundSkus.map((s) => s.id))
    for (const id of uniqueSkus) {
      if (!skuSet.has(id)) return { missingSkuId: id, missingUomId: null }
    }
  }

  const uniqueUoms = [...new Set(params.uomIds)]
  if (uniqueUoms.length > 0) {
    const foundUoms = await tx
      .select({ id: uom.id })
      .from(uom)
      .where(and(eq(uom.tenantId, params.tenantId), inArray(uom.id, uniqueUoms)))
    const uomSet = new Set(foundUoms.map((u) => u.id))
    for (const id of uniqueUoms) {
      if (!uomSet.has(id)) return { missingSkuId: null, missingUomId: id }
    }
  }

  return { missingSkuId: null, missingUomId: null }
}

export async function findMissingModifierId(
  tx: TenantTx,
  tenantId: string,
  modifierIds: readonly string[],
): Promise<string | null> {
  const uniqueIds = [...new Set(modifierIds)]
  if (uniqueIds.length === 0) return null
  const found = await tx
    .select({ id: modifier.id })
    .from(modifier)
    .where(and(eq(modifier.tenantId, tenantId), inArray(modifier.id, uniqueIds)))
  const set = new Set(found.map((m) => m.id))
  for (const id of uniqueIds) {
    if (!set.has(id)) return id
  }
  return null
}

export async function getSkuProductTypes(
  tx: TenantTx,
  tenantId: string,
  skuIds: readonly string[],
): Promise<Map<string, { productType: ProductType; trackStock: boolean }>> {
  const out = new Map<string, { productType: ProductType; trackStock: boolean }>()
  const uniqueIds = [...new Set(skuIds)]
  if (uniqueIds.length === 0) return out
  const rows = await tx
    .select({
      skuId: sku.id,
      productType: product.productType,
      trackStock: product.trackStock,
    })
    .from(sku)
    .innerJoin(product, and(eq(product.tenantId, sku.tenantId), eq(product.id, sku.productId)))
    .where(and(eq(sku.tenantId, tenantId), inArray(sku.id, uniqueIds)))
  for (const r of rows) {
    out.set(r.skuId, { productType: r.productType as ProductType, trackStock: r.trackStock })
  }
  return out
}

export async function getRecipeFor(
  tx: TenantTx,
  tenantId: string,
  menuSkuIds: readonly string[],
): Promise<Map<string, Array<{ ingredientSkuId: string; qty: string }>>> {
  const out = new Map<string, Array<{ ingredientSkuId: string; qty: string }>>()
  const uniqueIds = [...new Set(menuSkuIds)]
  if (uniqueIds.length === 0) return out
  const rows = await tx
    .select({
      menuSkuId: recipeItem.menuSkuId,
      ingredientSkuId: recipeItem.ingredientSkuId,
      qty: recipeItem.qty,
    })
    .from(recipeItem)
    .where(
      and(
        eq(recipeItem.tenantId, tenantId),
        inArray(recipeItem.menuSkuId, uniqueIds),
        isNull(recipeItem.deletedAt),
      ),
    )
  for (const r of rows) {
    let list = out.get(r.menuSkuId)
    if (!list) {
      list = []
      out.set(r.menuSkuId, list)
    }
    list.push({ ingredientSkuId: r.ingredientSkuId, qty: r.qty })
  }
  return out
}

export async function getModifierIngredients(
  tx: TenantTx,
  tenantId: string,
  modifierIds: readonly string[],
): Promise<Map<string, Array<{ ingredientSkuId: string; adjustType: ModifierAdjustType; qty: string | null }>>> {
  const out = new Map<
    string,
    Array<{ ingredientSkuId: string; adjustType: ModifierAdjustType; qty: string | null }>
  >()
  const uniqueIds = [...new Set(modifierIds)]
  if (uniqueIds.length === 0) return out
  const rows = await tx
    .select({
      modifierId: modifierIngredient.modifierId,
      ingredientSkuId: modifierIngredient.ingredientSkuId,
      adjustType: modifierIngredient.adjustType,
      qty: modifierIngredient.qty,
    })
    .from(modifierIngredient)
    .where(
      and(
        eq(modifierIngredient.tenantId, tenantId),
        inArray(modifierIngredient.modifierId, uniqueIds),
        isNull(modifierIngredient.deletedAt),
      ),
    )
  for (const r of rows) {
    let list = out.get(r.modifierId)
    if (!list) {
      list = []
      out.set(r.modifierId, list)
    }
    list.push({
      ingredientSkuId: r.ingredientSkuId,
      adjustType: r.adjustType as ModifierAdjustType,
      qty: r.qty,
    })
  }
  return out
}
