import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { chunkArray } from './chunk'
import { attributeValue, productAttribute, sku, skuAttributeValue } from './schema'

export interface ProductAttributeRow {
  id: string
  productId: string
  name: string
  sortOrder: number
  deletedAt: string | null
}

export interface AttributeValueRow {
  id: string
  attributeId: string
  value: string
  sortOrder: number
  deletedAt: string | null
}

export interface SkuRow {
  id: string
  productId: string
  skuCode: string
  variantLabel: string | null
  isDefault: boolean
  isActive: boolean
  sortOrder: number
  version: number
  deletedAt: string | null
}

export interface SkuAttributeValueRow {
  id: string
  skuId: string
  attributeValueId: string
  deletedAt: string | null
}

const skuSelect = {
  id: sku.id,
  productId: sku.productId,
  skuCode: sku.skuCode,
  variantLabel: sku.variantLabel,
  isDefault: sku.isDefault,
  isActive: sku.isActive,
  sortOrder: sku.sortOrder,
  version: sku.version,
  deletedAt: sku.deletedAt,
}

export async function findSkuById(tx: TenantTx, tenantId: string, skuId: string): Promise<SkuRow | null> {
  const rows = await tx
    .select(skuSelect)
    .from(sku)
    .where(and(eq(sku.tenantId, tenantId), eq(sku.id, skuId), isNull(sku.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function listSkusByProduct(
  tx: TenantTx,
  tenantId: string,
  productId: string,
): Promise<SkuRow[]> {
  return tx
    .select(skuSelect)
    .from(sku)
    .where(and(eq(sku.tenantId, tenantId), eq(sku.productId, productId), isNull(sku.deletedAt)))
    .orderBy(asc(sku.sortOrder), asc(sku.skuCode), asc(sku.id))
}

export async function listProductAttributes(
  tx: TenantTx,
  tenantId: string,
  productId: string,
): Promise<ProductAttributeRow[]> {
  return tx
    .select({
      id: productAttribute.id,
      productId: productAttribute.productId,
      name: productAttribute.name,
      sortOrder: productAttribute.sortOrder,
      deletedAt: productAttribute.deletedAt,
    })
    .from(productAttribute)
    .where(
      and(
        eq(productAttribute.tenantId, tenantId),
        eq(productAttribute.productId, productId),
        isNull(productAttribute.deletedAt),
      ),
    )
    .orderBy(asc(productAttribute.sortOrder), asc(productAttribute.name), asc(productAttribute.id))
}

export async function listAttributeValuesByAttributes(
  tx: TenantTx,
  tenantId: string,
  attributeIds: readonly string[],
): Promise<AttributeValueRow[]> {
  if (attributeIds.length === 0) return []
  return tx
    .select({
      id: attributeValue.id,
      attributeId: attributeValue.attributeId,
      value: attributeValue.value,
      sortOrder: attributeValue.sortOrder,
      deletedAt: attributeValue.deletedAt,
    })
    .from(attributeValue)
    .where(
      and(
        eq(attributeValue.tenantId, tenantId),
        inArray(attributeValue.attributeId, attributeIds),
        isNull(attributeValue.deletedAt),
      ),
    )
    .orderBy(asc(attributeValue.sortOrder), asc(attributeValue.value), asc(attributeValue.id))
}

export async function listSkuAttributeValueLinks(
  tx: TenantTx,
  tenantId: string,
  skuIds: readonly string[],
): Promise<SkuAttributeValueRow[]> {
  if (skuIds.length === 0) return []
  return tx
    .select({
      id: skuAttributeValue.id,
      skuId: skuAttributeValue.skuId,
      attributeValueId: skuAttributeValue.attributeValueId,
      deletedAt: skuAttributeValue.deletedAt,
    })
    .from(skuAttributeValue)
    .where(
      and(
        eq(skuAttributeValue.tenantId, tenantId),
        inArray(skuAttributeValue.skuId, skuIds),
        isNull(skuAttributeValue.deletedAt),
      ),
    )
}

export async function insertProductAttributeRow(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string | null,
  params: { id: string; productId: string; name: string; sortOrder: number; nowIso: string },
): Promise<ProductAttributeRow> {
  const rows = await tx
    .insert(productAttribute)
    .values({
      id: params.id,
      tenantId,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      deletedAt: null,
      productId: params.productId,
      name: params.name,
      sortOrder: params.sortOrder,
    })
    .returning({
      id: productAttribute.id,
      productId: productAttribute.productId,
      name: productAttribute.name,
      sortOrder: productAttribute.sortOrder,
      deletedAt: productAttribute.deletedAt,
    })
  return rows[0]!
}

export async function insertAttributeValueRow(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string | null,
  params: { id: string; attributeId: string; value: string; sortOrder: number; nowIso: string },
): Promise<AttributeValueRow> {
  const rows = await tx
    .insert(attributeValue)
    .values({
      id: params.id,
      tenantId,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      deletedAt: null,
      attributeId: params.attributeId,
      value: params.value,
      sortOrder: params.sortOrder,
    })
    .returning({
      id: attributeValue.id,
      attributeId: attributeValue.attributeId,
      value: attributeValue.value,
      sortOrder: attributeValue.sortOrder,
      deletedAt: attributeValue.deletedAt,
    })
  return rows[0]!
}

export async function tombstoneAttributeValueRow(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string | null,
  id: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(attributeValue)
    .set({ deletedAt: nowIso, updatedAt: nowIso, updatedBy: actorUserId })
    .where(and(eq(attributeValue.tenantId, tenantId), eq(attributeValue.id, id), isNull(attributeValue.deletedAt)))
}

export async function tombstoneProductAttributeRow(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string | null,
  id: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(productAttribute)
    .set({ deletedAt: nowIso, updatedAt: nowIso, updatedBy: actorUserId })
    .where(
      and(
        eq(productAttribute.tenantId, tenantId),
        eq(productAttribute.id, id),
        isNull(productAttribute.deletedAt),
      ),
    )
}

export async function insertSkuRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    productId: string
    skuCode: string
    variantLabel: string | null
    isDefault: boolean
    isActive: boolean
    sortOrder: number
    nowIso: string
  },
): Promise<SkuRow> {
  const rows = await tx
    .insert(sku)
    .values({
      id: params.id,
      tenantId: w.tenantId,
      version: w.version,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
      deletedAt: null,
      productId: params.productId,
      skuCode: params.skuCode,
      variantLabel: params.variantLabel,
      isDefault: params.isDefault,
      isActive: params.isActive,
      sortOrder: params.sortOrder,
    })
    .returning(skuSelect)
  return rows[0]!
}

export async function updateSkuRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    skuCode?: string
    variantLabel?: string | null
    isDefault?: boolean
    isActive?: boolean
    sortOrder?: number
    nowIso: string
  },
): Promise<SkuRow | null> {
  const rows = await tx
    .update(sku)
    .set({
      ...(params.skuCode !== undefined ? { skuCode: params.skuCode } : {}),
      ...(params.variantLabel !== undefined ? { variantLabel: params.variantLabel } : {}),
      ...(params.isDefault !== undefined ? { isDefault: params.isDefault } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.sortOrder !== undefined ? { sortOrder: params.sortOrder } : {}),
      version: w.version,
      updatedAt: params.nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(sku.tenantId, w.tenantId), eq(sku.id, params.id), isNull(sku.deletedAt)))
    .returning(skuSelect)
  return rows[0] ?? null
}

export async function tombstoneSkuRow(
  tx: TenantTx,
  w: MasterWriter,
  id: string,
  nowIso: string,
): Promise<boolean> {
  const rows = await tx
    .update(sku)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(sku.tenantId, w.tenantId), eq(sku.id, id), isNull(sku.deletedAt)))
    .returning({ id: sku.id })
  return rows.length > 0
}

export async function insertSkuAttributeValueRow(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string | null,
  params: { id: string; skuId: string; attributeValueId: string; nowIso: string },
): Promise<void> {
  await tx
    .insert(skuAttributeValue)
    .values({
      id: params.id,
      tenantId,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      deletedAt: null,
      skuId: params.skuId,
      attributeValueId: params.attributeValueId,
    })
    .onConflictDoUpdate({
      target: [skuAttributeValue.skuId, skuAttributeValue.attributeValueId],
      set: {
        deletedAt: null,
        updatedAt: params.nowIso,
        updatedBy: actorUserId,
      },
    })
}

export async function tombstoneSkuAttributeValuesForSku(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string | null,
  skuId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(skuAttributeValue)
    .set({ deletedAt: nowIso, updatedAt: nowIso, updatedBy: actorUserId })
    .where(
      and(
        eq(skuAttributeValue.tenantId, tenantId),
        eq(skuAttributeValue.skuId, skuId),
        isNull(skuAttributeValue.deletedAt),
      ),
    )
}

export async function listSkusByCodes(
  tx: TenantTx,
  tenantId: string,
  skuCodes: readonly string[],
): Promise<SkuRow[]> {
  if (skuCodes.length === 0) return []
  const out: SkuRow[] = []
  for (const batch of chunkArray(skuCodes)) {
    const rows = await tx
      .select(skuSelect)
      .from(sku)
      .where(and(eq(sku.tenantId, tenantId), inArray(sku.skuCode, batch), isNull(sku.deletedAt)))
    out.push(...rows)
  }
  return out
}

export async function listSkusByProductIds(
  tx: TenantTx,
  tenantId: string,
  productIds: readonly string[],
): Promise<SkuRow[]> {
  if (productIds.length === 0) return []
  const out: SkuRow[] = []
  for (const batch of chunkArray(productIds)) {
    const rows = await tx
      .select(skuSelect)
      .from(sku)
      .where(and(eq(sku.tenantId, tenantId), inArray(sku.productId, batch), isNull(sku.deletedAt)))
    out.push(...rows)
  }
  return out
}

export async function listAllActiveSkus(
  tx: TenantTx,
  tenantId: string,
  limit = 20_000,
): Promise<SkuRow[]> {
  return tx
    .select(skuSelect)
    .from(sku)
    .where(and(eq(sku.tenantId, tenantId), isNull(sku.deletedAt)))
    .orderBy(asc(sku.productId), asc(sku.sortOrder), asc(sku.skuCode), asc(sku.id))
    .limit(limit)
}

export async function listProductAttributesByProductIds(
  tx: TenantTx,
  tenantId: string,
  productIds: readonly string[],
): Promise<ProductAttributeRow[]> {
  if (productIds.length === 0) return []
  const out: ProductAttributeRow[] = []
  for (const batch of chunkArray(productIds)) {
    const rows = await tx
      .select({
        id: productAttribute.id,
        productId: productAttribute.productId,
        name: productAttribute.name,
        sortOrder: productAttribute.sortOrder,
        deletedAt: productAttribute.deletedAt,
      })
      .from(productAttribute)
      .where(
        and(
          eq(productAttribute.tenantId, tenantId),
          inArray(productAttribute.productId, batch),
          isNull(productAttribute.deletedAt),
        ),
      )
    out.push(...rows)
  }
  return out
}

export async function upsertSkuBatch(
  tx: TenantTx,
  w: MasterWriter,
  items: ReadonlyArray<{
    id: string
    productId: string
    skuCode: string
    variantLabel: string | null
    isDefault: boolean
    isActive: boolean
    sortOrder: number
    nowIso: string
  }>,
): Promise<void> {
  for (const batch of chunkArray(items)) {
    await tx
      .insert(sku)
      .values(
        batch.map((p) => ({
          id: p.id,
          tenantId: w.tenantId,
          version: w.version,
          createdAt: p.nowIso,
          updatedAt: p.nowIso,
          createdBy: w.actorUserId,
          updatedBy: w.actorUserId,
          deletedAt: null,
          productId: p.productId,
          skuCode: p.skuCode,
          variantLabel: p.variantLabel,
          isDefault: p.isDefault,
          isActive: p.isActive,
          sortOrder: p.sortOrder,
        })),
      )
      .onConflictDoUpdate({
        target: [sku.tenantId, sku.id],
        set: {
          skuCode: sql`excluded.sku_code`,
          variantLabel: sql`excluded.variant_label`,
          isDefault: sql`excluded.is_default`,
          isActive: sql`excluded.is_active`,
          sortOrder: sql`excluded.sort_order`,
          deletedAt: null,
          version: w.version,
          updatedAt: sql`excluded.updated_at`,
          updatedBy: w.actorUserId,
        },
      })
  }
}

export async function insertProductAttributeBatch(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string | null,
  items: ReadonlyArray<{ id: string; productId: string; name: string; sortOrder: number; nowIso: string }>,
): Promise<void> {
  for (const batch of chunkArray(items)) {
    await tx
      .insert(productAttribute)
      .values(
        batch.map((p) => ({
          id: p.id,
          tenantId,
          createdAt: p.nowIso,
          updatedAt: p.nowIso,
          createdBy: actorUserId,
          updatedBy: actorUserId,
          deletedAt: null,
          productId: p.productId,
          name: p.name,
          sortOrder: p.sortOrder,
        })),
      )
      .onConflictDoNothing()
  }
}

export async function insertAttributeValueBatch(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string | null,
  items: ReadonlyArray<{ id: string; attributeId: string; value: string; sortOrder: number; nowIso: string }>,
): Promise<void> {
  for (const batch of chunkArray(items)) {
    await tx
      .insert(attributeValue)
      .values(
        batch.map((p) => ({
          id: p.id,
          tenantId,
          createdAt: p.nowIso,
          updatedAt: p.nowIso,
          createdBy: actorUserId,
          updatedBy: actorUserId,
          deletedAt: null,
          attributeId: p.attributeId,
          value: p.value,
          sortOrder: p.sortOrder,
        })),
      )
      .onConflictDoNothing()
  }
}

export async function insertSkuAttributeValueBatch(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string | null,
  items: ReadonlyArray<{ id: string; skuId: string; attributeValueId: string; nowIso: string }>,
): Promise<void> {
  for (const batch of chunkArray(items)) {
    await tx
      .insert(skuAttributeValue)
      .values(
        batch.map((p) => ({
          id: p.id,
          tenantId,
          createdAt: p.nowIso,
          updatedAt: p.nowIso,
          createdBy: actorUserId,
          updatedBy: actorUserId,
          deletedAt: null,
          skuId: p.skuId,
          attributeValueId: p.attributeValueId,
        })),
      )
      .onConflictDoNothing()
  }
}
