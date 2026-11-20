import '@tanstack/react-start/server-only'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { toMoney } from '~/lib/kernel'
import type { TenantTx } from '~/server/db'
import { resolvePrice, type PriceResolution } from '../domain/price'
import type { AvailabilityStatus } from '../shared'
import { itemOutletAvailability, priceEntry, product, sku, uom } from './schema'

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
