import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { sku, skuUom } from './schema'

export interface SkuUomRow {
  id: string
  skuId: string
  uomId: string
  conversionFactor: string
  isBase: boolean
  barcode: string | null
  version: number
  deletedAt: string | null
}

const skuUomSelect = {
  id: skuUom.id,
  skuId: skuUom.skuId,
  uomId: skuUom.uomId,
  conversionFactor: skuUom.conversionFactor,
  isBase: skuUom.isBase,
  barcode: skuUom.barcode,
  version: skuUom.version,
  deletedAt: skuUom.deletedAt,
}

export async function findSkuUomById(tx: TenantTx, tenantId: string, id: string): Promise<SkuUomRow | null> {
  const rows = await tx
    .select(skuUomSelect)
    .from(skuUom)
    .where(and(eq(skuUom.tenantId, tenantId), eq(skuUom.id, id), isNull(skuUom.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function findSkuUomBySkuAndUom(
  tx: TenantTx,
  tenantId: string,
  skuId: string,
  uomId: string,
): Promise<SkuUomRow | null> {
  const rows = await tx
    .select(skuUomSelect)
    .from(skuUom)
    .where(
      and(
        eq(skuUom.tenantId, tenantId),
        eq(skuUom.skuId, skuId),
        eq(skuUom.uomId, uomId),
        isNull(skuUom.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function listSkuUomsBySkuIds(
  tx: TenantTx,
  tenantId: string,
  skuIds: readonly string[],
): Promise<SkuUomRow[]> {
  if (skuIds.length === 0) return []
  return tx
    .select(skuUomSelect)
    .from(skuUom)
    .where(and(eq(skuUom.tenantId, tenantId), inArray(skuUom.skuId, skuIds), isNull(skuUom.deletedAt)))
    .orderBy(asc(skuUom.skuId), asc(skuUom.uomId))
}

export async function findActiveSkuUomByBarcode(
  tx: TenantTx,
  tenantId: string,
  barcode: string,
  excludeId?: string,
): Promise<SkuUomRow | null> {
  const conditions = [
    eq(skuUom.tenantId, tenantId),
    eq(skuUom.barcode, barcode),
    isNull(skuUom.deletedAt),
  ]
  if (excludeId !== undefined) {
    conditions.push(ne(skuUom.id, excludeId))
  }
  const rows = await tx
    .select(skuUomSelect)
    .from(skuUom)
    .where(and(...conditions))
    .limit(1)
  return rows[0] ?? null
}

export async function hasNonBaseActiveSkuUomForProductAndUom(
  tx: TenantTx,
  tenantId: string,
  productId: string,
  uomId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: skuUom.id })
    .from(skuUom)
    .innerJoin(sku, and(eq(sku.tenantId, skuUom.tenantId), eq(sku.id, skuUom.skuId)))
    .where(
      and(
        eq(skuUom.tenantId, tenantId),
        eq(sku.productId, productId),
        eq(skuUom.uomId, uomId),
        eq(skuUom.isBase, false),
        isNull(skuUom.deletedAt),
        isNull(sku.deletedAt),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export async function upsertSkuUomRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    skuId: string
    uomId: string
    conversionFactor: string
    isBase: boolean
    barcode: string | null
    nowIso: string
  },
): Promise<SkuUomRow> {
  const rows = await tx
    .insert(skuUom)
    .values({
      id: params.id,
      tenantId: w.tenantId,
      version: w.version,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
      deletedAt: null,
      skuId: params.skuId,
      uomId: params.uomId,
      conversionFactor: params.conversionFactor,
      isBase: params.isBase,
      barcode: params.barcode,
    })
    .onConflictDoUpdate({
      target: [skuUom.skuId, skuUom.uomId],
      set: {
        conversionFactor: params.conversionFactor,
        isBase: params.isBase,
        barcode: params.barcode,
        deletedAt: null,
        version: w.version,
        updatedAt: params.nowIso,
        updatedBy: w.actorUserId,
      },
    })
    .returning(skuUomSelect)
  return rows[0]!
}

export async function updateSkuUomRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    conversionFactor?: string
    barcode?: string | null
    nowIso: string
  },
): Promise<SkuUomRow | null> {
  const rows = await tx
    .update(skuUom)
    .set({
      ...(params.conversionFactor !== undefined ? { conversionFactor: params.conversionFactor } : {}),
      ...(params.barcode !== undefined ? { barcode: params.barcode } : {}),
      version: w.version,
      updatedAt: params.nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(skuUom.tenantId, w.tenantId), eq(skuUom.id, params.id), isNull(skuUom.deletedAt)))
    .returning(skuUomSelect)
  return rows[0] ?? null
}

export async function updateBaseSkuUomForProduct(
  tx: TenantTx,
  w: MasterWriter,
  productId: string,
  newBaseUomId: string,
  nowIso: string,
): Promise<void> {
  const productSkus = await tx
    .select({ id: sku.id })
    .from(sku)
    .where(and(eq(sku.tenantId, w.tenantId), eq(sku.productId, productId), isNull(sku.deletedAt)))

  if (productSkus.length === 0) return

  await tx
    .update(skuUom)
    .set({
      uomId: newBaseUomId,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(skuUom.tenantId, w.tenantId),
        inArray(
          skuUom.skuId,
          productSkus.map((r) => r.id),
        ),
        eq(skuUom.isBase, true),
        isNull(skuUom.deletedAt),
      ),
    )
}

export async function tombstoneSkuUomRow(
  tx: TenantTx,
  w: MasterWriter,
  id: string,
  nowIso: string,
): Promise<boolean> {
  const rows = await tx
    .update(skuUom)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(skuUom.tenantId, w.tenantId), eq(skuUom.id, id), isNull(skuUom.deletedAt)))
    .returning({ id: skuUom.id })
  return rows.length > 0
}

export async function tombstoneSkuUomsBySku(
  tx: TenantTx,
  w: MasterWriter,
  skuId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(skuUom)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(skuUom.tenantId, w.tenantId), eq(skuUom.skuId, skuId), isNull(skuUom.deletedAt)))
}
