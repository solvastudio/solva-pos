import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { saveRecipeSchema } from '~/lib/contracts'
import {
  getRecipeForMenuSku,
  listIngredientOptions,
  saveRecipe,
} from '~/modules/catalog/public'
import type { IngredientOptionView, MenuRecipeResult } from '~/modules/catalog/shared'
import type { MutationActionResult } from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const getRecipeInputSchema = z.object({
  menuSkuId: z.string().uuid(),
})

const ingredientOptionsInputSchema = z.object({
  excludeMenuSkuId: z.string().uuid().optional(),
})

export const getRecipeForMenuSkuFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => getRecipeInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MenuRecipeResult> => {
    return getRecipeForMenuSku(context.auth, data.menuSkuId)
  })

export const listIngredientOptionsFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => ingredientOptionsInputSchema.parse(raw ?? {}))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<IngredientOptionView[]> => {
    return listIngredientOptions(context.auth, data.excludeMenuSkuId)
  })

export const saveRecipeFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => saveRecipeSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<MenuRecipeResult>> => {
    return runValidatedAction(() => saveRecipe(context.auth, data))
  })
