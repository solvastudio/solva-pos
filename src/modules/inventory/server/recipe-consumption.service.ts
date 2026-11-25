import '@tanstack/react-start/server-only'
import type { ModifierAdjustType } from '~/lib/contracts'
import type { Qty } from '~/lib/kernel'
import {
  effectiveIngredients,
  type EffectiveModifierIngredient,
  type ProductType,
} from '~/modules/catalog/shared'
import type { MovementIntent } from './ledger.service'

export interface RecipeConsumptionLineInput {
  readonly lineId: string
  readonly lineNo: number
  readonly lineKind: 'ITEM' | 'SHARE' | 'STOCK_BASIS'
  readonly skuId: string | null
  readonly qtyBase: Qty
  readonly modifiers?: readonly { readonly modifierId: string | null; readonly qty: number }[]
}

export interface BuildRecipeIntentsInput {
  readonly outletId: string
  readonly occurredAt: string
  readonly businessDate: string
  readonly lines: readonly RecipeConsumptionLineInput[]
  readonly skuTypes: ReadonlyMap<string, { readonly productType: ProductType; readonly trackStock: boolean }>
  readonly recipesByMenuSku: ReadonlyMap<string, readonly { readonly ingredientSkuId: string; readonly qty: string }[]>
  readonly modifierIngredientsByModifier: ReadonlyMap<
    string,
    readonly { readonly ingredientSkuId: string; readonly adjustType: ModifierAdjustType; readonly qty: string | null }[]
  >
}

export interface BuildRecipeIntentsResult {
  readonly intents: readonly MovementIntent[]
  readonly missingRecipeLineIds: readonly string[]
  readonly recipeMenuLineIds: readonly string[]
}

/**
 * Pure builder producing deterministic `RECIPE_CONSUMPTION` intents for tracked `MENU_FNB` lines (BR-RCP-003..006, V-17).
 */
export function buildRecipeIntents(input: BuildRecipeIntentsInput): BuildRecipeIntentsResult {
  const intents: MovementIntent[] = []
  const missingRecipeLineIds: string[] = []
  const recipeMenuLineIds: string[] = []

  const sortedLines = [...input.lines].sort((a, b) => a.lineNo - b.lineNo)
  for (const line of sortedLines) {
    if ((line.lineKind !== 'ITEM' && line.lineKind !== 'STOCK_BASIS') || !line.skuId) continue
    const meta = input.skuTypes.get(line.skuId)
    if (!meta || meta.productType !== 'MENU_FNB' || !meta.trackStock) continue

    const recipe = input.recipesByMenuSku.get(line.skuId)
    if (!recipe || recipe.length === 0) {
      missingRecipeLineIds.push(line.lineId)
      continue
    }

    recipeMenuLineIds.push(line.lineId)

    const modAdjustments: EffectiveModifierIngredient[] = []
    for (const mod of line.modifiers ?? []) {
      if (!mod.modifierId) continue
      const ingList = input.modifierIngredientsByModifier.get(mod.modifierId)
      if (!ingList) continue
      for (const ing of ingList) {
        modAdjustments.push({
          ingredientSkuId: ing.ingredientSkuId,
          adjustType: ing.adjustType,
          qty: ing.qty,
          modifierQty: mod.qty,
        })
      }
    }

    const effective = effectiveIngredients(recipe, modAdjustments, line.qtyBase)
    for (let idx = 0; idx < effective.length; idx += 1) {
      const eff = effective[idx]!
      intents.push({
        outletId: input.outletId,
        skuId: eff.ingredientSkuId,
        kind: 'OUT',
        qty: eff.qty,
        movementType: 'RECIPE_CONSUMPTION',
        sourceType: 'SALE_LINE',
        sourceId: line.lineId,
        occurredAt: input.occurredAt,
        businessDate: input.businessDate,
        order: line.lineNo * 1000 + idx + 1,
      })
    }
  }

  return {
    intents,
    missingRecipeLineIds,
    recipeMenuLineIds,
  }
}
