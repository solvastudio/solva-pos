import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  addAttributeValue,
  addSkuUom,
  createCategory,
  createProduct,
  createUom,
  deleteCategory,
  deleteUom,
  removeAttributeValue,
  removeSkuUom,
  saveAvailabilityAcrossOutlets,
  setPricesAcrossOutlets,
  updateCategory,
  updateProduct,
  updateSku,
  updateSkuUom,
  updateUom,
  type CategoryRow,
  type CreateProductResult,
  type ProductRow,
  type UomRow,
} from '~/modules/catalog/public'
import {
  AVAILABILITY_STATUSES,
  createCategorySchema,
  createProductSchema,
  createUomSchema,
  updateCategorySchema,
  updateProductSchema,
  updateUomSchema,
  type FeatureFlagJson,
  type FeatureFlagView,
} from '~/modules/catalog/shared'
import { clearFeatureFlag, setFeatureFlag } from '~/modules/identity/public'
import type { MutationActionResult } from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const saveCategorySchema = z.union([
  updateCategorySchema,
  createCategorySchema,
])

const saveUomSchema = z.union([
  updateUomSchema,
  createUomSchema,
])

const idInputSchema = z.object({
  id: z.string().uuid(),
})

const saveVariantsInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('addValue'),
    productId: z.string().uuid(),
    attributeId: z.string().uuid(),
    value: z.string().trim().min(1).max(40),
  }),
  z.object({
    action: z.literal('removeValue'),
    productId: z.string().uuid(),
    attributeValueId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('updateSku'),
    skuId: z.string().uuid(),
    skuCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9\-_.]{1,40}$/)
      .optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }),
])

const saveSkuUomsInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    skuId: z.string().uuid(),
    uomId: z.string().uuid(),
    conversionFactor: z.string().trim().min(1),
    barcode: z.string().trim().max(64).nullable().optional(),
  }),
  z.object({
    action: z.literal('update'),
    id: z.string().uuid(),
    conversionFactor: z.string().trim().min(1).optional(),
    barcode: z.string().trim().max(64).nullable().optional(),
  }),
  z.object({
    action: z.literal('remove'),
    id: z.string().uuid(),
  }),
])

const savePricesInputSchema = z.object({
  entries: z
    .array(
      z.object({
        skuId: z.string().uuid(),
        uomId: z.string().uuid(),
        outletId: z.string().uuid().nullable(),
        price: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(500),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

const saveAvailabilityInputSchema = z.object({
  outletUpdates: z
    .array(
      z.object({
        outletId: z.string().uuid(),
        productId: z.string().uuid(),
        skuId: z.string().uuid().nullable().optional(),
        status: z.enum(AVAILABILITY_STATUSES),
      }),
    )
    .max(1000)
    .default([]),
  clearOverrides: z
    .array(
      z.object({
        outletId: z.string().uuid(),
        productId: z.string().uuid(),
        skuId: z.string().uuid(),
      }),
    )
    .max(1000)
    .default([]),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

const setFeatureFlagInputSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_.]{2,63}$/),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
})

const clearFeatureFlagInputSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_.]{2,63}$/),
})

export const saveCategoryFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => saveCategorySchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<CategoryRow>> => {
    return runValidatedAction(() =>
      'id' in data ? updateCategory(context.auth, data) : createCategory(context.auth, data),
    )
  })

export const deleteCategoryFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ id: string }>> => {
    return runValidatedAction(() => deleteCategory(context.auth, data.id))
  })

export const saveUomFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => saveUomSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<UomRow>> => {
    return runValidatedAction(() =>
      'id' in data ? updateUom(context.auth, data) : createUom(context.auth, data),
    )
  })

export const deleteUomFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ id: string }>> => {
    return runValidatedAction(() => deleteUom(context.auth, data.id))
  })

export const createProductFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => createProductSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<CreateProductResult>> => {
    return runValidatedAction(() => createProduct(context.auth, data))
  })

export const updateProductFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => updateProductSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<ProductRow>> => {
    return runValidatedAction(() => updateProduct(context.auth, data))
  })

export const deactivateProductFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<ProductRow>> => {
    return runValidatedAction(() =>
      updateProduct(context.auth, { id: data.id, isActive: false }),
    )
  })

export const saveVariantsFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => saveVariantsInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ saved: true }>> => {
    return runValidatedAction(async () => {
      if (data.action === 'addValue') {
        await addAttributeValue(context.auth, data)
      } else if (data.action === 'removeValue') {
        await removeAttributeValue(context.auth, data)
      } else {
        await updateSku(context.auth, data)
      }
      return { saved: true as const }
    })
  })

export const saveSkuUomsFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => saveSkuUomsInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ saved: true }>> => {
    return runValidatedAction(async () => {
      if (data.action === 'add') {
        await addSkuUom(context.auth, data)
      } else if (data.action === 'update') {
        await updateSkuUom(context.auth, data)
      } else {
        await removeSkuUom(context.auth, data.id)
      }
      return { saved: true as const }
    })
  })

export const savePricesFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => savePricesInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ savedCount: number }>> => {
    return runValidatedAction(async () => {
      const res = await setPricesAcrossOutlets(context.auth, {
        entries: data.entries,
        reasonText: data.reasonText ?? null,
      })
      return { savedCount: res.savedCount }
    })
  })

export const saveAvailabilityFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => saveAvailabilityInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ savedCount: number }>> => {
    return runValidatedAction(async () => {
      const res = await saveAvailabilityAcrossOutlets(context.auth, {
        updates: data.outletUpdates,
        clears: data.clearOverrides,
        reasonText: data.reasonText ?? null,
      })
      return { savedCount: res.savedCount }
    })
  })

export const setFeatureFlagFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => setFeatureFlagInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('flag.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<FeatureFlagView>> => {
    return runValidatedAction(async () => {
      const row = await setFeatureFlag(context.auth, data)
      return {
        ...row,
        params: (row.params ?? null) as Record<string, FeatureFlagJson> | null,
      }
    })
  })

export const clearFeatureFlagFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => clearFeatureFlagInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('flag.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ cleared: boolean }>> => {
    return runValidatedAction(() => clearFeatureFlag(context.auth, data.key))
  })
