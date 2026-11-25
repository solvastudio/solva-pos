import { D, normalizeQty, parseQty, qtyToDecimal, type Qty } from '~/lib/kernel'
import type { ModifierAdjustType } from '~/lib/contracts'
import type { ProductType } from '../shared'

export interface RecipeItemInput {
  readonly ingredientSkuId: string
  readonly qty: string
}

export interface RecipeSkuMeta {
  readonly productType?: ProductType
  readonly trackStock?: boolean
  readonly hasOwnRecipe?: boolean
  readonly usedAsIngredientInRecipe?: boolean
}

export interface ValidateRecipeContext {
  readonly menuProductType: ProductType
  readonly menuUsedAsIngredient?: boolean
  readonly ingredientsBySkuId: ReadonlyMap<string, RecipeSkuMeta>
}

export type RecipeValidationIssueCode =
  | 'MENU_MUST_BE_FNB'
  | 'SELF_INGREDIENT'
  | 'DUPLICATE_INGREDIENT'
  | 'INVALID_QTY'
  | 'NON_POSITIVE_QTY'
  | 'UNKNOWN_INGREDIENT'
  | 'MULTI_LEVEL_RECIPE'

export interface RecipeValidationIssue {
  readonly code: RecipeValidationIssueCode
  readonly ingredientSkuId?: string
  readonly message: string
}

export interface RecipeValidationWarning {
  readonly code: 'INGREDIENT_NOT_TRACKED'
  readonly ingredientSkuId: string
  readonly message: string
}

export interface ValidateRecipeResult {
  readonly ok: boolean
  readonly errors: readonly RecipeValidationIssue[]
  readonly warnings: readonly RecipeValidationWarning[]
  readonly normalizedItems: readonly { ingredientSkuId: string; qty: Qty }[]
}

/**
 * Pure recipe validator checking single-level BOM, product types, scale-4 positive quantities,
 * duplicate ingredients, and untracked stock warnings (BR-RCP-001/002).
 */
export function validateRecipe(
  menuSkuId: string,
  items: readonly RecipeItemInput[],
  ctx: ValidateRecipeContext,
): ValidateRecipeResult {
  const errors: RecipeValidationIssue[] = []
  const warnings: RecipeValidationWarning[] = []
  const normalizedItems: { ingredientSkuId: string; qty: Qty }[] = []

  if (ctx.menuProductType !== 'MENU_FNB') {
    errors.push({
      code: 'MENU_MUST_BE_FNB',
      message: 'Recipe can only be defined for MENU_FNB products',
    })
  }

  if (ctx.menuUsedAsIngredient && items.length > 0) {
    errors.push({
      code: 'MULTI_LEVEL_RECIPE',
      message: 'Menu SKU cannot have a recipe while used as an ingredient in another recipe',
    })
  }

  const seen = new Set<string>()
  for (const item of items) {
    if (item.ingredientSkuId === menuSkuId) {
      errors.push({
        code: 'SELF_INGREDIENT',
        ingredientSkuId: item.ingredientSkuId,
        message: 'Menu SKU cannot reference itself as an ingredient',
      })
      continue
    }

    if (seen.has(item.ingredientSkuId)) {
      errors.push({
        code: 'DUPLICATE_INGREDIENT',
        ingredientSkuId: item.ingredientSkuId,
        message: 'Duplicate ingredient SKU in recipe',
      })
      continue
    }
    seen.add(item.ingredientSkuId)

    let parsedQty: Qty
    try {
      parsedQty = parseQty(item.qty)
    } catch {
      errors.push({
        code: 'INVALID_QTY',
        ingredientSkuId: item.ingredientSkuId,
        message: `Invalid scale-4 quantity "${item.qty}"`,
      })
      continue
    }

    if (qtyToDecimal(parsedQty).lte(0)) {
      errors.push({
        code: 'NON_POSITIVE_QTY',
        ingredientSkuId: item.ingredientSkuId,
        message: 'Ingredient quantity must be greater than zero',
      })
      continue
    }

    const meta = ctx.ingredientsBySkuId.get(item.ingredientSkuId)
    if (!meta) {
      errors.push({
        code: 'UNKNOWN_INGREDIENT',
        ingredientSkuId: item.ingredientSkuId,
        message: `Unknown ingredient SKU ${item.ingredientSkuId}`,
      })
      continue
    }

    if (meta.hasOwnRecipe) {
      errors.push({
        code: 'MULTI_LEVEL_RECIPE',
        ingredientSkuId: item.ingredientSkuId,
        message: 'Ingredient SKU cannot itself be a menu with a recipe (BR-RCP-001)',
      })
      continue
    }

    if (meta.trackStock === false) {
      warnings.push({
        code: 'INGREDIENT_NOT_TRACKED',
        ingredientSkuId: item.ingredientSkuId,
        message: 'Ingredient does not track stock; consumption will have no balance effect',
      })
    }

    normalizedItems.push({
      ingredientSkuId: item.ingredientSkuId,
      qty: parsedQty,
    })
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalizedItems,
  }
}

export interface RecipeBaseIngredient {
  readonly ingredientSkuId: string
  readonly qty: Qty | string
}

export interface EffectiveModifierIngredient {
  readonly ingredientSkuId: string
  readonly adjustType: ModifierAdjustType
  readonly qty: Qty | string | null
  /** Number of times this modifier choice was selected per 1 unit of menu line (default 1). */
  readonly modifierQty?: number
}

export interface EffectiveIngredient {
  readonly ingredientSkuId: string
  readonly qty: Qty
}

/**
 * Pure BR-RCP-004 effective ingredient computation per sale/recipe line:
 * `max(0, qty_recipe + sum(ADD) - sum(REDUCE))` (or 0 if any REMOVE exists) * portions,
 * ordered deterministically by `ingredientSkuId` ASC, omitting zero totals.
 */
export function effectiveIngredients(
  recipe: readonly RecipeBaseIngredient[],
  modifiers: readonly EffectiveModifierIngredient[],
  portions: Qty | string,
): EffectiveIngredient[] {
  const portionDec = qtyToDecimal(typeof portions === 'string' ? parseQty(portions) : portions)
  if (portionDec.lte(0)) {
    return []
  }

  const acc = new Map<
    string,
    { base: ReturnType<typeof qtyToDecimal>; add: ReturnType<typeof qtyToDecimal>; reduce: ReturnType<typeof qtyToDecimal>; removed: boolean }
  >()

  const getSlot = (skuId: string) => {
    let slot = acc.get(skuId)
    if (!slot) {
      slot = {
        base: new D(0),
        add: new D(0),
        reduce: new D(0),
        removed: false,
      }
      acc.set(skuId, slot)
    }
    return slot
  }

  for (const row of recipe) {
    const q = typeof row.qty === 'string' ? parseQty(row.qty) : row.qty
    const slot = getSlot(row.ingredientSkuId)
    slot.base = slot.base.plus(qtyToDecimal(q))
  }

  for (const mod of modifiers) {
    const slot = getSlot(mod.ingredientSkuId)
    if (mod.adjustType === 'REMOVE') {
      slot.removed = true
      continue
    }
    if (mod.qty === null) continue
    const q = typeof mod.qty === 'string' ? parseQty(mod.qty) : mod.qty
    const mult = mod.modifierQty ?? 1
    if (mult <= 0) continue
    const delta = qtyToDecimal(q).times(mult)
    if (mod.adjustType === 'ADD') {
      slot.add = slot.add.plus(delta)
    } else if (mod.adjustType === 'REDUCE') {
      slot.reduce = slot.reduce.plus(delta)
    }
  }

  const out: EffectiveIngredient[] = []
  const sortedIds = [...acc.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  for (const ingredientSkuId of sortedIds) {
    const slot = acc.get(ingredientSkuId)!
    if (slot.removed) continue

    const perPortion = slot.base.plus(slot.add).minus(slot.reduce)
    if (perPortion.lte(0)) continue

    const total = perPortion.times(portionDec).toDecimalPlaces(4, D.ROUND_HALF_UP)
    if (total.lte(0)) continue

    out.push({
      ingredientSkuId,
      qty: normalizeQty(total.toFixed() as Qty),
    })
  }

  return out
}
