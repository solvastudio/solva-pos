import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createModifierGroupSchema,
  createModifierSchema,
  linkModifierGroupProductSchema,
  unlinkModifierGroupProductSchema,
  updateModifierGroupSchema,
  updateModifierSchema,
} from '~/lib/contracts'
import {
  createModifier,
  createModifierGroup,
  deleteModifier,
  deleteModifierGroup,
  linkModifierGroupProduct,
  listModifierGroups,
  listProductModifierGroups,
  unlinkModifierGroupProduct,
  updateModifier,
  updateModifierGroup,
  type ModifierGroupRow,
} from '~/modules/catalog/public'
import type {
  ModifierGroupView,
  ModifierView,
  ProductModifierGroupView,
} from '~/modules/catalog/shared'
import type { MutationActionResult } from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const idInputSchema = z.object({ id: z.string().uuid() })
const productIdInputSchema = z.object({ productId: z.string().uuid() })

export const listModifierGroupsFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ context }): Promise<ModifierGroupView[]> => {
    return listModifierGroups(context.auth)
  })

export const listProductModifierGroupsFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => productIdInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<ProductModifierGroupView[]> => {
    return listProductModifierGroups(context.auth, data.productId)
  })

export const createModifierGroupFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => createModifierGroupSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<ModifierGroupRow>> => {
    return runValidatedAction(() => createModifierGroup(context.auth, data))
  })

export const updateModifierGroupFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => updateModifierGroupSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<ModifierGroupRow>> => {
    return runValidatedAction(() => updateModifierGroup(context.auth, data))
  })

export const deleteModifierGroupFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ deleted: true }>> => {
    return runValidatedAction(async () => {
      await deleteModifierGroup(context.auth, data.id)
      return { deleted: true as const }
    })
  })

export const createModifierFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => createModifierSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<ModifierView>> => {
    return runValidatedAction(() => createModifier(context.auth, data))
  })

export const updateModifierFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => updateModifierSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<ModifierView>> => {
    return runValidatedAction(() => updateModifier(context.auth, data))
  })

export const deleteModifierFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ deleted: true }>> => {
    return runValidatedAction(async () => {
      await deleteModifier(context.auth, data.id)
      return { deleted: true as const }
    })
  })

export const linkModifierGroupProductFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => linkModifierGroupProductSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(
    async ({
      data,
      context,
    }): Promise<
      MutationActionResult<{
        id: string
        modifierGroupId: string
        productId: string
        sortOrder: number
        version: number
      }>
    > => {
      return runValidatedAction(() => linkModifierGroupProduct(context.auth, data))
    },
  )

export const unlinkModifierGroupProductFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => unlinkModifierGroupProductSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ unlinked: true }>> => {
    return runValidatedAction(async () => {
      await unlinkModifierGroupProduct(context.auth, data)
      return { unlinked: true as const }
    })
  })
