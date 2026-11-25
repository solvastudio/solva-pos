import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import type { IngredientOptionView, ProductType } from '../shared'
import type { RecipeSkuMeta } from '../domain/recipe'
import { chunkArray } from './chunk'
import { product, sku, uom } from './schema'
import { recipeItem } from './schema-fnb'

export interface MenuSkuMetaRow {
  skuId: string
  productId: string
  productType: ProductType
  trackStock: boolean
  usedAsIngredient: boolean
}

export interface RecipeItemDetailRow {
  id: string
  menuSkuId: string
  ingredientSkuId: string
  ingredientSkuCode: string
  ingredientProductName: string
  ingredientTrackStock: boolean
  uomCode: string
  qty: string
}

export async function findMenuSkuMeta(
  tx: TenantTx,
  tenantId: string,
  menuSkuId: string,
): Promise<MenuSkuMetaRow | null> {
  const rows = await tx
    .select({
      skuId: sku.id,
      productId: product.id,
      productType: product.productType,
      trackStock: product.trackStock,
    })
    .from(sku)
    .innerJoin(
      product,
      and(eq(product.tenantId, sku.tenantId), eq(product.id, sku.productId), isNull(product.deletedAt)),
    )
    .where(and(eq(sku.tenantId, tenantId), eq(sku.id, menuSkuId), isNull(sku.deletedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const usedRows = await tx
    .select({ id: recipeItem.id })
    .from(recipeItem)
    .where(
      and(
        eq(recipeItem.tenantId, tenantId),
        eq(recipeItem.ingredientSkuId, menuSkuId),
        isNull(recipeItem.deletedAt),
      ),
    )
    .limit(1)

  return {
    skuId: row.skuId,
    productId: row.productId,
    productType: row.productType as ProductType,
    trackStock: row.trackStock,
    usedAsIngredient: usedRows.length > 0,
  }
}

export async function findIngredientSkusMeta(
  tx: TenantTx,
  tenantId: string,
  skuIds: readonly string[],
): Promise<Map<string, RecipeSkuMeta>> {
  const map = new Map<string, RecipeSkuMeta>()
  if (skuIds.length === 0) return map

  const uniqueIds = [...new Set(skuIds)]
  const hasOwnRecipeSet = new Set<string>()
  for (const chunk of chunkArray(uniqueIds)) {
    const recipeRows = await tx
      .select({ menuSkuId: recipeItem.menuSkuId })
      .from(recipeItem)
      .where(
        and(
          eq(recipeItem.tenantId, tenantId),
          inArray(recipeItem.menuSkuId, chunk),
          isNull(recipeItem.deletedAt),
        ),
      )
    for (const r of recipeRows) hasOwnRecipeSet.add(r.menuSkuId)

    const skuRows = await tx
      .select({
        skuId: sku.id,
        productType: product.productType,
        trackStock: product.trackStock,
      })
      .from(sku)
      .innerJoin(
        product,
        and(eq(product.tenantId, sku.tenantId), eq(product.id, sku.productId), isNull(product.deletedAt)),
      )
      .where(and(eq(sku.tenantId, tenantId), inArray(sku.id, chunk), isNull(sku.deletedAt)))

    for (const s of skuRows) {
      map.set(s.skuId, {
        productType: s.productType as ProductType,
        trackStock: s.trackStock,
        hasOwnRecipe: hasOwnRecipeSet.has(s.skuId),
      })
    }
  }
  return map
}

export async function listRecipeRowsForMenuSku(
  tx: TenantTx,
  tenantId: string,
  menuSkuId: string,
): Promise<RecipeItemDetailRow[]> {
  return tx
    .select({
      id: recipeItem.id,
      menuSkuId: recipeItem.menuSkuId,
      ingredientSkuId: recipeItem.ingredientSkuId,
      ingredientSkuCode: sku.skuCode,
      ingredientProductName: product.name,
      ingredientTrackStock: product.trackStock,
      uomCode: uom.code,
      qty: recipeItem.qty,
    })
    .from(recipeItem)
    .innerJoin(
      sku,
      and(eq(sku.tenantId, recipeItem.tenantId), eq(sku.id, recipeItem.ingredientSkuId)),
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
        eq(recipeItem.tenantId, tenantId),
        eq(recipeItem.menuSkuId, menuSkuId),
        isNull(recipeItem.deletedAt),
      ),
    )
    .orderBy(asc(product.name), asc(sku.skuCode), asc(recipeItem.id))
}

export async function softDeleteRecipeRowsForMenuSku(
  tx: TenantTx,
  tenantId: string,
  menuSkuId: string,
  actorUserId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(recipeItem)
    .set({
      deletedAt: nowIso,
      updatedAt: nowIso,
      updatedBy: actorUserId,
    })
    .where(
      and(
        eq(recipeItem.tenantId, tenantId),
        eq(recipeItem.menuSkuId, menuSkuId),
        isNull(recipeItem.deletedAt),
      ),
    )
}

export async function insertRecipeRows(
  tx: TenantTx,
  tenantId: string,
  menuSkuId: string,
  items: readonly { id: string; ingredientSkuId: string; qty: string }[],
  actorUserId: string,
  nowIso: string,
): Promise<void> {
  if (items.length === 0) return
  await tx.insert(recipeItem).values(
    items.map((item) => ({
      id: item.id,
      tenantId,
      menuSkuId,
      ingredientSkuId: item.ingredientSkuId,
      qty: item.qty,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })),
  )
}

export async function listIngredientOptionRows(
  tx: TenantTx,
  tenantId: string,
  excludeMenuSkuId?: string,
): Promise<IngredientOptionView[]> {
  const conditions = [
    eq(sku.tenantId, tenantId),
    isNull(sku.deletedAt),
    isNull(product.deletedAt),
    eq(product.isActive, true),
    eq(sku.isActive, true),
    sql`NOT EXISTS (
      SELECT 1 FROM recipe_item r
      WHERE r.tenant_id = ${sku.tenantId}
        AND r.menu_sku_id = ${sku.id}
        AND r.deleted_at IS NULL
    )`,
  ]
  if (excludeMenuSkuId) {
    conditions.push(ne(sku.id, excludeMenuSkuId))
  }

  const rows = await tx
    .select({
      skuId: sku.id,
      skuCode: sku.skuCode,
      productId: product.id,
      productName: product.name,
      productType: product.productType,
      trackStock: product.trackStock,
      uomCode: uom.code,
    })
    .from(sku)
    .innerJoin(
      product,
      and(eq(product.tenantId, sku.tenantId), eq(product.id, sku.productId)),
    )
    .innerJoin(
      uom,
      and(eq(uom.tenantId, product.tenantId), eq(uom.id, product.baseUomId)),
    )
    .where(and(...conditions))
    .orderBy(asc(product.name), asc(sku.skuCode), asc(sku.id))

  return rows.map((r) => ({
    ...r,
    productType: r.productType as ProductType,
  }))
}
