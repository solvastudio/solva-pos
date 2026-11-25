import { z } from 'zod'
import { MODIFIER_ADJUST_TYPE, MODIFIER_SELECTION_TYPE } from './enums'
import { zMoney, zQtyPositive, zSafeNonNegInt, zUuid } from './primitives'

export const FNB_TABLE_CODE_REGEX = /^[A-Za-z0-9\-_.]{1,10}$/

export const createFnbTableSchema = z.object({
  outletId: zUuid,
  code: z
    .string()
    .trim()
    .regex(FNB_TABLE_CODE_REGEX, 'Table code must match ^[A-Za-z0-9\\-_.]{1,10}$'),
  area: z.string().trim().max(40).nullable().optional(),
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
  sortOrder: z.number().int().default(0),
})

export const updateFnbTableSchema = z.object({
  id: zUuid,
  code: z
    .string()
    .trim()
    .regex(FNB_TABLE_CODE_REGEX, 'Table code must match ^[A-Za-z0-9\\-_.]{1,10}$')
    .optional(),
  area: z.string().trim().max(40).nullable().optional(),
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
})

export const createModifierGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    selectionType: z.enum(MODIFIER_SELECTION_TYPE).default('MULTI'),
    minSelect: zSafeNonNegInt.default(0),
    maxSelect: zSafeNonNegInt.nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.maxSelect !== null && v.maxSelect !== undefined && v.maxSelect < v.minSelect) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxSelect'],
        message: 'maxSelect must be >= minSelect',
      })
    }
    if (v.selectionType === 'SINGLE' && v.minSelect > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['minSelect'],
        message: 'SINGLE selection cannot require more than 1 item',
      })
    }
  })

export const updateModifierGroupSchema = z
  .object({
    id: zUuid,
    name: z.string().trim().min(1).max(60).optional(),
    selectionType: z.enum(MODIFIER_SELECTION_TYPE).optional(),
    minSelect: zSafeNonNegInt.optional(),
    maxSelect: zSafeNonNegInt.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.maxSelect !== null &&
      v.maxSelect !== undefined &&
      v.minSelect !== undefined &&
      v.maxSelect < v.minSelect
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxSelect'],
        message: 'maxSelect must be >= minSelect',
      })
    }
  })

export const modifierIngredientInputSchema = z
  .object({
    ingredientSkuId: zUuid,
    adjustType: z.enum(MODIFIER_ADJUST_TYPE),
    qty: zQtyPositive.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.adjustType === 'REMOVE' && v.qty !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['qty'],
        message: 'REMOVE adjustment must have null qty',
      })
    }
    if (v.adjustType !== 'REMOVE' && v.qty === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['qty'],
        message: 'ADD and REDUCE adjustments require positive qty',
      })
    }
  })

export const createModifierSchema = z.object({
  modifierGroupId: zUuid,
  name: z.string().trim().min(1).max(60),
  priceDelta: zMoney.default(0),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  ingredients: z.array(modifierIngredientInputSchema).optional(),
})

export const updateModifierSchema = z.object({
  id: zUuid,
  name: z.string().trim().min(1).max(60).optional(),
  priceDelta: zMoney.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  ingredients: z.array(modifierIngredientInputSchema).optional(),
})

export const linkModifierGroupProductSchema = z.object({
  modifierGroupId: zUuid,
  productId: zUuid,
  sortOrder: z.number().int().default(0),
})

export const unlinkModifierGroupProductSchema = z.object({
  modifierGroupId: zUuid,
  productId: zUuid,
})

export const recipeItemInputSchema = z.object({
  ingredientSkuId: zUuid,
  qty: zQtyPositive,
})

export const saveRecipeSchema = z
  .object({
    menuSkuId: zUuid,
    items: z.array(recipeItemInputSchema),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>()
    for (let i = 0; i < v.items.length; i += 1) {
      const item = v.items[i]!
      if (item.ingredientSkuId === v.menuSkuId) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'ingredientSkuId'],
          message: 'Menu SKU cannot be its own ingredient',
        })
      }
      if (seen.has(item.ingredientSkuId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'ingredientSkuId'],
          message: 'Duplicate ingredient SKU in recipe',
        })
      }
      seen.add(item.ingredientSkuId)
    }
  })

export type CreateFnbTableInput = z.input<typeof createFnbTableSchema>
export type UpdateFnbTableInput = z.input<typeof updateFnbTableSchema>
export type CreateModifierGroupInput = z.input<typeof createModifierGroupSchema>
export type UpdateModifierGroupInput = z.input<typeof updateModifierGroupSchema>
export type ModifierIngredientInput = z.input<typeof modifierIngredientInputSchema>
export type CreateModifierInput = z.input<typeof createModifierSchema>
export type UpdateModifierInput = z.input<typeof updateModifierSchema>
export type LinkModifierGroupProductInput = z.input<typeof linkModifierGroupProductSchema>
export type SaveRecipeInput = z.input<typeof saveRecipeSchema>
