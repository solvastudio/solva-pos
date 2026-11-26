import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { saveRecipeSchema, type SaveRecipeInput } from '~/lib/contracts'
import { D, normalizeQty } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { withTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { parseOrThrow } from '~/server/parse-or-throw'
import { validateRecipe } from '../domain/recipe'
import type { IngredientOptionView, MenuRecipeResult, RecipeItemView } from '../shared'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  type CatalogActor,
  type CatalogServiceDeps,
} from './auth'
import {
  findIngredientSkusMeta,
  findMenuSkuMeta,
  insertRecipeRows,
  listIngredientOptionRows,
  listRecipeRowsForMenuSku,
  softDeleteRecipeRowsForMenuSku,
  type RecipeItemDetailRow,
} from './recipe.repo'

const uuidSchema = z.string().uuid()

/**
 * Optional read-only port returning estimated average unit cost (IDR bigint number) per ingredient SKU.
 * Registered by `composeServer()` so `catalog` stays independent of `inventory`.
 */
export type RecipeCostReaderPort = (
  tx: TenantTx,
  tenantId: string,
  skuIds: readonly string[],
) => Promise<ReadonlyMap<string, number>>

let costReaderPort: RecipeCostReaderPort | null = null

export function registerRecipeCostReaderPort(port: RecipeCostReaderPort | null): void {
  costReaderPort = port
}

async function buildMenuRecipeResult(
  tx: TenantTx,
  tenantId: string,
  menuSkuId: string,
  rows: readonly RecipeItemDetailRow[],
): Promise<MenuRecipeResult> {
  const unitCosts =
    costReaderPort && rows.length > 0
      ? await costReaderPort(
          tx,
          tenantId,
          rows.map((r) => r.ingredientSkuId),
        )
      : new Map<string, number>()

  let totalCost: number | null = rows.length > 0 ? 0 : null
  const warnings: MenuRecipeResult['warnings'] = []
  const items: RecipeItemView[] = rows.map((r) => {
    const unitCost = unitCosts.get(r.ingredientSkuId) ?? null
    const lineCost =
      unitCost !== null ? D(unitCost).mul(D(r.qty)).round().toNumber() : null
    if (lineCost === null) {
      totalCost = null
    } else if (totalCost !== null) {
      totalCost += lineCost
    }
    if (!r.ingredientTrackStock) {
      warnings.push({
        code: 'INGREDIENT_NOT_TRACKED',
        ingredientSkuId: r.ingredientSkuId,
        message: 'Ingredient does not track stock; consumption will have no balance effect',
      })
    }
    return {
      id: r.id,
      menuSkuId: r.menuSkuId,
      ingredientSkuId: r.ingredientSkuId,
      ingredientSkuCode: r.ingredientSkuCode,
      ingredientProductName: r.ingredientProductName,
      ingredientTrackStock: r.ingredientTrackStock,
      uomCode: r.uomCode,
      qty: r.qty,
      estimatedUnitCost: unitCost,
      estimatedLineCost: lineCost,
    }
  })

  return {
    menuSkuId,
    items,
    estimatedTotalCost: totalCost,
    warnings,
  }
}

export async function getRecipeForMenuSku(
  actor: CatalogActor,
  menuSkuId: string,
): Promise<MenuRecipeResult> {
  requireCatalogPermission(actor)
  if (!uuidSchema.safeParse(menuSkuId).success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid menuSkuId')
  }

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const meta = await findMenuSkuMeta(tx, actor.tenantId, menuSkuId)
    if (!meta) {
      throw new AppError('VALIDATION_FAILED', 'Menu SKU not found')
    }
    const rows = await listRecipeRowsForMenuSku(tx, actor.tenantId, menuSkuId)
    return buildMenuRecipeResult(tx, actor.tenantId, menuSkuId, rows)
  })
}

export async function saveRecipe(
  actor: CatalogActor,
  rawInput: SaveRecipeInput,
  deps?: CatalogServiceDeps,
): Promise<MenuRecipeResult> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(saveRecipeSchema, rawInput, 'Invalid recipe input')
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const menuMeta = await findMenuSkuMeta(tx, actor.tenantId, parsed.menuSkuId)
    if (!menuMeta) {
      throw new AppError('VALIDATION_FAILED', 'Menu SKU not found')
    }

    const ingredientsMeta = await findIngredientSkusMeta(
      tx,
      actor.tenantId,
      parsed.items.map((i) => i.ingredientSkuId),
    )

    const validation = validateRecipe(parsed.menuSkuId, parsed.items, {
      menuProductType: menuMeta.productType,
      menuUsedAsIngredient: menuMeta.usedAsIngredient,
      ingredientsBySkuId: ingredientsMeta,
    })

    if (!validation.ok) {
      const firstErr = validation.errors[0]
      throw new AppError('VALIDATION_FAILED', firstErr?.message ?? 'Invalid recipe')
    }

    const beforeRows = await listRecipeRowsForMenuSku(tx, actor.tenantId, parsed.menuSkuId)
    const normalizedToInsert = validation.normalizedItems.map((item) => ({
      id: newIdFrom(deps),
      ingredientSkuId: item.ingredientSkuId,
      qty: normalizeQty(item.qty),
    }))

    await softDeleteRecipeRowsForMenuSku(
      tx,
      actor.tenantId,
      parsed.menuSkuId,
      actor.appUserId,
      nowIso,
    )
    await insertRecipeRows(
      tx,
      actor.tenantId,
      parsed.menuSkuId,
      normalizedToInsert,
      actor.appUserId,
      nowIso,
    )

    await appendAudit(
      tx,
      {
        actorUserId: actor.appUserId,
        action: 'recipe.changed',
        entityType: 'recipe',
        entityId: parsed.menuSkuId,
        beforeData: {
          items: beforeRows.map((r) => ({ ingredientSkuId: r.ingredientSkuId, qty: r.qty })),
        },
        afterData: {
          items: normalizedToInsert.map((r) => ({
            ingredientSkuId: r.ingredientSkuId,
            qty: r.qty,
          })),
        },
        occurredAt: nowIso,
      },
      { newId: () => newIdFrom(deps), nowIso: () => nowIso },
    )

    const afterRows = await listRecipeRowsForMenuSku(tx, actor.tenantId, parsed.menuSkuId)
    return buildMenuRecipeResult(tx, actor.tenantId, parsed.menuSkuId, afterRows)
  })
}

export async function listIngredientOptions(
  actor: CatalogActor,
  excludeMenuSkuId?: string,
): Promise<IngredientOptionView[]> {
  requireCatalogPermission(actor)
  if (excludeMenuSkuId !== undefined && !uuidSchema.safeParse(excludeMenuSkuId).success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid excludeMenuSkuId')
  }
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    return listIngredientOptionRows(tx, actor.tenantId, excludeMenuSkuId)
  })
}
