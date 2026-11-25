import '@tanstack/react-start/server-only'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { ModifierAdjustType, ModifierSelectionType } from '~/lib/contracts'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { chunkArray } from './chunk'
import { priceEntry, product, sku, uom } from './schema'
import { modifier, modifierGroup, modifierGroupProduct, modifierIngredient } from './schema-fnb'

export interface ModifierGroupRow {
  id: string
  name: string
  selectionType: ModifierSelectionType
  minSelect: number
  maxSelect: number | null
  isActive: boolean
  version: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ModifierRow {
  id: string
  modifierGroupId: string
  name: string
  priceDelta: number
  isActive: boolean
  sortOrder: number
  version: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ModifierIngredientDetailRow {
  id: string
  modifierId: string
  ingredientSkuId: string
  ingredientSkuCode: string
  ingredientProductName: string
  uomCode: string
  adjustType: ModifierAdjustType
  qty: string | null
}

export interface ProductModifierGroupLinkRow {
  linkId: string
  modifierGroupId: string
  productId: string
  sortOrder: number
  groupName: string
  selectionType: ModifierSelectionType
  minSelect: number
  maxSelect: number | null
  isActive: boolean
}

const modifierGroupSelect = {
  id: modifierGroup.id,
  name: modifierGroup.name,
  selectionType: modifierGroup.selectionType,
  minSelect: modifierGroup.minSelect,
  maxSelect: modifierGroup.maxSelect,
  isActive: modifierGroup.isActive,
  version: modifierGroup.version,
  deletedAt: modifierGroup.deletedAt,
  createdAt: modifierGroup.createdAt,
  updatedAt: modifierGroup.updatedAt,
}

const modifierSelect = {
  id: modifier.id,
  modifierGroupId: modifier.modifierGroupId,
  name: modifier.name,
  priceDelta: modifier.priceDelta,
  isActive: modifier.isActive,
  sortOrder: modifier.sortOrder,
  version: modifier.version,
  deletedAt: modifier.deletedAt,
  createdAt: modifier.createdAt,
  updatedAt: modifier.updatedAt,
}

export async function findModifierGroupById(
  tx: TenantTx,
  tenantId: string,
  id: string,
): Promise<ModifierGroupRow | null> {
  const rows = await tx
    .select(modifierGroupSelect)
    .from(modifierGroup)
    .where(and(eq(modifierGroup.tenantId, tenantId), eq(modifierGroup.id, id), isNull(modifierGroup.deletedAt)))
    .limit(1)
  const r = rows[0]
  return r ? { ...r, selectionType: r.selectionType as ModifierSelectionType } : null
}

export async function listModifierGroupsRows(
  tx: TenantTx,
  tenantId: string,
): Promise<ModifierGroupRow[]> {
  const rows = await tx
    .select(modifierGroupSelect)
    .from(modifierGroup)
    .where(and(eq(modifierGroup.tenantId, tenantId), isNull(modifierGroup.deletedAt)))
    .orderBy(asc(modifierGroup.name), asc(modifierGroup.id))
  return rows.map((r) => ({ ...r, selectionType: r.selectionType as ModifierSelectionType }))
}

export async function insertModifierGroupRow(
  tx: TenantTx,
  w: MasterWriter,
  input: {
    id: string
    name: string
    selectionType: ModifierSelectionType
    minSelect: number
    maxSelect: number | null
    isActive: boolean
    nowIso: string
  },
): Promise<ModifierGroupRow> {
  const rows = await tx
    .insert(modifierGroup)
    .values({
      id: input.id,
      tenantId: w.tenantId,
      name: input.name,
      selectionType: input.selectionType,
      minSelect: input.minSelect,
      maxSelect: input.maxSelect,
      isActive: input.isActive,
      version: w.version,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
    })
    .returning(modifierGroupSelect)
  const r = rows[0]!
  return { ...r, selectionType: r.selectionType as ModifierSelectionType }
}

export async function updateModifierGroupRow(
  tx: TenantTx,
  w: MasterWriter,
  input: {
    id: string
    name: string
    selectionType: ModifierSelectionType
    minSelect: number
    maxSelect: number | null
    isActive: boolean
    nowIso: string
  },
): Promise<ModifierGroupRow> {
  const rows = await tx
    .update(modifierGroup)
    .set({
      name: input.name,
      selectionType: input.selectionType,
      minSelect: input.minSelect,
      maxSelect: input.maxSelect,
      isActive: input.isActive,
      version: w.version,
      updatedAt: input.nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(modifierGroup.tenantId, w.tenantId),
        eq(modifierGroup.id, input.id),
        isNull(modifierGroup.deletedAt),
      ),
    )
    .returning(modifierGroupSelect)
  const r = rows[0]!
  return { ...r, selectionType: r.selectionType as ModifierSelectionType }
}

export async function tombstoneModifierGroupRow(
  tx: TenantTx,
  w: MasterWriter,
  id: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(modifierGroup)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(modifierGroup.tenantId, w.tenantId),
        eq(modifierGroup.id, id),
        isNull(modifierGroup.deletedAt),
      ),
    )
}

export async function findModifierById(
  tx: TenantTx,
  tenantId: string,
  id: string,
): Promise<ModifierRow | null> {
  const rows = await tx
    .select(modifierSelect)
    .from(modifier)
    .where(and(eq(modifier.tenantId, tenantId), eq(modifier.id, id), isNull(modifier.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function listModifiersByGroupIds(
  tx: TenantTx,
  tenantId: string,
  groupIds: readonly string[],
): Promise<ModifierRow[]> {
  if (groupIds.length === 0) return []
  const out: ModifierRow[] = []
  for (const chunk of chunkArray(groupIds)) {
    const rows = await tx
      .select(modifierSelect)
      .from(modifier)
      .where(
        and(
          eq(modifier.tenantId, tenantId),
          inArray(modifier.modifierGroupId, chunk),
          isNull(modifier.deletedAt),
        ),
      )
      .orderBy(asc(modifier.sortOrder), asc(modifier.name), asc(modifier.id))
    out.push(...rows)
  }
  return out
}

export async function insertModifierRow(
  tx: TenantTx,
  w: MasterWriter,
  input: {
    id: string
    modifierGroupId: string
    name: string
    priceDelta: number
    isActive: boolean
    sortOrder: number
    nowIso: string
  },
): Promise<ModifierRow> {
  const rows = await tx
    .insert(modifier)
    .values({
      id: input.id,
      tenantId: w.tenantId,
      modifierGroupId: input.modifierGroupId,
      name: input.name,
      priceDelta: input.priceDelta,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      version: w.version,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
    })
    .returning(modifierSelect)
  return rows[0]!
}

export async function updateModifierRow(
  tx: TenantTx,
  w: MasterWriter,
  input: {
    id: string
    name: string
    priceDelta: number
    isActive: boolean
    sortOrder: number
    nowIso: string
  },
): Promise<ModifierRow> {
  const rows = await tx
    .update(modifier)
    .set({
      name: input.name,
      priceDelta: input.priceDelta,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      version: w.version,
      updatedAt: input.nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(modifier.tenantId, w.tenantId), eq(modifier.id, input.id), isNull(modifier.deletedAt)))
    .returning(modifierSelect)
  return rows[0]!
}

export async function tombstoneModifierRow(
  tx: TenantTx,
  w: MasterWriter,
  id: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(modifier)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(modifier.tenantId, w.tenantId), eq(modifier.id, id), isNull(modifier.deletedAt)))
}

export async function tombstoneModifiersByGroupId(
  tx: TenantTx,
  w: MasterWriter,
  groupId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(modifier)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(modifier.tenantId, w.tenantId),
        eq(modifier.modifierGroupId, groupId),
        isNull(modifier.deletedAt),
      ),
    )
}

export async function listModifierIngredientsByModifierIds(
  tx: TenantTx,
  tenantId: string,
  modifierIds: readonly string[],
): Promise<ModifierIngredientDetailRow[]> {
  if (modifierIds.length === 0) return []
  const out: ModifierIngredientDetailRow[] = []
  for (const chunk of chunkArray(modifierIds)) {
    const rows = await tx
      .select({
        id: modifierIngredient.id,
        modifierId: modifierIngredient.modifierId,
        ingredientSkuId: modifierIngredient.ingredientSkuId,
        ingredientSkuCode: sku.skuCode,
        ingredientProductName: product.name,
        uomCode: uom.code,
        adjustType: modifierIngredient.adjustType,
        qty: modifierIngredient.qty,
      })
      .from(modifierIngredient)
      .innerJoin(
        sku,
        and(eq(sku.tenantId, modifierIngredient.tenantId), eq(sku.id, modifierIngredient.ingredientSkuId)),
      )
      .innerJoin(
        product,
        and(eq(product.tenantId, sku.tenantId), eq(product.id, sku.productId)),
      )
      .innerJoin(
        uom,
        and(eq(uom.tenantId, product.tenantId), eq(uom.id, product.baseUomId)),
      )
      .where(
        and(
          eq(modifierIngredient.tenantId, tenantId),
          inArray(modifierIngredient.modifierId, chunk),
          isNull(modifierIngredient.deletedAt),
        ),
      )
      .orderBy(asc(product.name), asc(sku.skuCode), asc(modifierIngredient.id))
    for (const r of rows) {
      out.push({
        ...r,
        adjustType: r.adjustType as ModifierAdjustType,
      })
    }
  }
  return out
}

export async function softDeleteModifierIngredients(
  tx: TenantTx,
  tenantId: string,
  modifierId: string,
  actorUserId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(modifierIngredient)
    .set({
      deletedAt: nowIso,
      updatedAt: nowIso,
      updatedBy: actorUserId,
    })
    .where(
      and(
        eq(modifierIngredient.tenantId, tenantId),
        eq(modifierIngredient.modifierId, modifierId),
        isNull(modifierIngredient.deletedAt),
      ),
    )
}

export async function softDeleteModifierIngredientsByGroupId(
  tx: TenantTx,
  tenantId: string,
  groupId: string,
  actorUserId: string,
  nowIso: string,
): Promise<void> {
  const modRows = await tx
    .select({ id: modifier.id })
    .from(modifier)
    .where(
      and(
        eq(modifier.tenantId, tenantId),
        eq(modifier.modifierGroupId, groupId),
        isNull(modifier.deletedAt),
      ),
    )
  const modIds = modRows.map((m) => m.id)
  if (modIds.length === 0) return
  for (const chunk of chunkArray(modIds)) {
    await tx
      .update(modifierIngredient)
      .set({
        deletedAt: nowIso,
        updatedAt: nowIso,
        updatedBy: actorUserId,
      })
      .where(
        and(
          eq(modifierIngredient.tenantId, tenantId),
          inArray(modifierIngredient.modifierId, chunk),
          isNull(modifierIngredient.deletedAt),
        ),
      )
  }
}

export async function insertModifierIngredientRows(
  tx: TenantTx,
  tenantId: string,
  modifierId: string,
  rows: readonly {
    id: string
    ingredientSkuId: string
    adjustType: ModifierAdjustType
    qty: string | null
  }[],
  actorUserId: string,
  nowIso: string,
): Promise<void> {
  if (rows.length === 0) return
  await tx.insert(modifierIngredient).values(
    rows.map((r) => ({
      id: r.id,
      tenantId,
      modifierId,
      ingredientSkuId: r.ingredientSkuId,
      adjustType: r.adjustType,
      qty: r.qty,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })),
  )
}

export async function countLinkedProductsByGroup(
  tx: TenantTx,
  tenantId: string,
): Promise<ReadonlyMap<string, number>> {
  const rows = await tx
    .select({
      modifierGroupId: modifierGroupProduct.modifierGroupId,
      cnt: sql<number>`count(*)::int`,
    })
    .from(modifierGroupProduct)
    .innerJoin(
      product,
      and(
        eq(product.tenantId, modifierGroupProduct.tenantId),
        eq(product.id, modifierGroupProduct.productId),
        isNull(product.deletedAt),
      ),
    )
    .where(and(eq(modifierGroupProduct.tenantId, tenantId), isNull(modifierGroupProduct.deletedAt)))
    .groupBy(modifierGroupProduct.modifierGroupId)

  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(r.modifierGroupId, Number(r.cnt))
  }
  return map
}

export async function listProductModifierGroupLinks(
  tx: TenantTx,
  tenantId: string,
  productId: string,
): Promise<ProductModifierGroupLinkRow[]> {
  const rows = await tx
    .select({
      linkId: modifierGroupProduct.id,
      modifierGroupId: modifierGroupProduct.modifierGroupId,
      productId: modifierGroupProduct.productId,
      sortOrder: modifierGroupProduct.sortOrder,
      groupName: modifierGroup.name,
      selectionType: modifierGroup.selectionType,
      minSelect: modifierGroup.minSelect,
      maxSelect: modifierGroup.maxSelect,
      isActive: modifierGroup.isActive,
    })
    .from(modifierGroupProduct)
    .innerJoin(
      modifierGroup,
      and(
        eq(modifierGroup.tenantId, modifierGroupProduct.tenantId),
        eq(modifierGroup.id, modifierGroupProduct.modifierGroupId),
        isNull(modifierGroup.deletedAt),
      ),
    )
    .where(
      and(
        eq(modifierGroupProduct.tenantId, tenantId),
        eq(modifierGroupProduct.productId, productId),
        isNull(modifierGroupProduct.deletedAt),
      ),
    )
    .orderBy(asc(modifierGroupProduct.sortOrder), asc(modifierGroup.name), asc(modifierGroup.id))

  return rows.map((r) => ({ ...r, selectionType: r.selectionType as ModifierSelectionType }))
}

export async function findActiveModifierGroupProduct(
  tx: TenantTx,
  tenantId: string,
  modifierGroupId: string,
  productId: string,
): Promise<{ id: string } | null> {
  const rows = await tx
    .select({ id: modifierGroupProduct.id })
    .from(modifierGroupProduct)
    .where(
      and(
        eq(modifierGroupProduct.tenantId, tenantId),
        eq(modifierGroupProduct.modifierGroupId, modifierGroupId),
        eq(modifierGroupProduct.productId, productId),
        isNull(modifierGroupProduct.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function upsertModifierGroupProductRow(
  tx: TenantTx,
  w: MasterWriter,
  input: {
    id: string
    modifierGroupId: string
    productId: string
    sortOrder: number
    nowIso: string
  },
): Promise<{ id: string; modifierGroupId: string; productId: string; sortOrder: number; version: number }> {
  const rows = await tx
    .insert(modifierGroupProduct)
    .values({
      id: input.id,
      tenantId: w.tenantId,
      modifierGroupId: input.modifierGroupId,
      productId: input.productId,
      sortOrder: input.sortOrder,
      version: w.version,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
    })
    .onConflictDoUpdate({
      target: [modifierGroupProduct.modifierGroupId, modifierGroupProduct.productId],
      set: {
        deletedAt: null,
        sortOrder: input.sortOrder,
        version: w.version,
        updatedAt: input.nowIso,
        updatedBy: w.actorUserId,
      },
    })
    .returning({
      id: modifierGroupProduct.id,
      modifierGroupId: modifierGroupProduct.modifierGroupId,
      productId: modifierGroupProduct.productId,
      sortOrder: modifierGroupProduct.sortOrder,
      version: modifierGroupProduct.version,
    })
  return rows[0]!
}

export async function tombstoneModifierGroupProductRow(
  tx: TenantTx,
  w: MasterWriter,
  modifierGroupId: string,
  productId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(modifierGroupProduct)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(modifierGroupProduct.tenantId, w.tenantId),
        eq(modifierGroupProduct.modifierGroupId, modifierGroupId),
        eq(modifierGroupProduct.productId, productId),
        isNull(modifierGroupProduct.deletedAt),
      ),
    )
}

export async function tombstoneModifierGroupProductsByGroupId(
  tx: TenantTx,
  w: MasterWriter,
  groupId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(modifierGroupProduct)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(modifierGroupProduct.tenantId, w.tenantId),
        eq(modifierGroupProduct.modifierGroupId, groupId),
        isNull(modifierGroupProduct.deletedAt),
      ),
    )
}

export async function findProductMetaForModifier(
  tx: TenantTx,
  tenantId: string,
  productId: string,
): Promise<{ id: string; productType: string } | null> {
  const rows = await tx
    .select({ id: product.id, productType: product.productType })
    .from(product)
    .where(and(eq(product.tenantId, tenantId), eq(product.id, productId), isNull(product.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function findActiveSkuIdsSet(
  tx: TenantTx,
  tenantId: string,
  skuIds: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>()
  if (skuIds.length === 0) return found
  for (const chunk of chunkArray(skuIds)) {
    const rows = await tx
      .select({ id: sku.id })
      .from(sku)
      .innerJoin(
        product,
        and(eq(product.tenantId, sku.tenantId), eq(product.id, sku.productId), isNull(product.deletedAt)),
      )
      .where(and(eq(sku.tenantId, tenantId), inArray(sku.id, chunk), isNull(sku.deletedAt)))
    for (const r of rows) found.add(r.id)
  }
  return found
}

export async function getMinEffectiveBasePriceForProduct(
  tx: TenantTx,
  tenantId: string,
  productId: string,
): Promise<number | null> {
  const skuRows = await tx
    .select({ id: sku.id })
    .from(sku)
    .where(and(eq(sku.tenantId, tenantId), eq(sku.productId, productId), isNull(sku.deletedAt)))
  if (skuRows.length === 0) return null

  const skuIds = skuRows.map((s) => s.id)
  const priceRows = await tx
    .select({
      skuId: priceEntry.skuId,
      outletId: priceEntry.outletId,
      price: priceEntry.price,
    })
    .from(priceEntry)
    .where(
      and(
        eq(priceEntry.tenantId, tenantId),
        inArray(priceEntry.skuId, skuIds),
        isNull(priceEntry.deletedAt),
      ),
    )
    .orderBy(desc(priceEntry.version))

  if (priceRows.length === 0) return null

  const latestByScope = new Map<string, number>()
  for (const row of priceRows) {
    const key = `${row.skuId}:${row.outletId ?? 'DEFAULT'}`
    if (!latestByScope.has(key)) {
      latestByScope.set(key, row.price)
    }
  }

  let minPrice: number | null = null
  for (const price of latestByScope.values()) {
    if (minPrice === null || price < minPrice) minPrice = price
  }
  return minPrice
}
