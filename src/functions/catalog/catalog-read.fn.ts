import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  getAdminProductDetail,
  getAvailabilityMatrix,
  getPriceMatrix,
  listAdminProducts,
  listCatalogOutlets,
  listCategories,
  listUoms,
  type AdminProductDetail,
  type AdminProductListResult,
  type AvailabilityMatrixResult,
  type CategoryRow,
  type OutletSummary,
  type PriceMatrixResult,
  type UomRow,
} from '~/modules/catalog/public'
import {
  PRODUCT_TYPES,
  type FeatureFlagJson,
  type FeatureFlagView,
} from '~/modules/catalog/shared'
import { listFeatureFlags } from '~/modules/identity/public'
import { requireAnyPermission, requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware } from '../middleware'

const listProductsInputSchema = z.object({
  search: z.string().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  type: z.enum(PRODUCT_TYPES).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
})

const getProductInputSchema = z.object({
  id: z.string().uuid(),
})

const priceMatrixInputSchema = z.object({
  search: z.string().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  onlyMissing: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(100),
})

const availabilityMatrixInputSchema = z.object({
  search: z.string().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  onlyExceptions: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
})

export const listProductsFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => listProductsInputSchema.parse(raw ?? {}))
  .middleware([publicErrorMiddleware, requireAnyPermission('catalog.view', 'catalog.manage')])
  .handler(async ({ data, context }): Promise<AdminProductListResult> => {
    return listAdminProducts(context.auth, data)
  })

export const getProductFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => getProductInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requireAnyPermission('catalog.view', 'catalog.manage')])
  .handler(async ({ data, context }): Promise<AdminProductDetail | null> => {
    return getAdminProductDetail(context.auth, data.id)
  })

export const getPriceMatrixFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => priceMatrixInputSchema.parse(raw ?? {}))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<PriceMatrixResult> => {
    return getPriceMatrix(context.auth, data)
  })

export const getAvailabilityMatrixFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => availabilityMatrixInputSchema.parse(raw ?? {}))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<AvailabilityMatrixResult> => {
    return getAvailabilityMatrix(context.auth, data)
  })

export const listCategoriesFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requireAnyPermission('catalog.view', 'catalog.manage')])
  .handler(async ({ context }): Promise<CategoryRow[]> => {
    return listCategories(context.auth)
  })

export const listUomsFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requireAnyPermission('catalog.view', 'catalog.manage')])
  .handler(async ({ context }): Promise<UomRow[]> => {
    return listUoms(context.auth)
  })

export const listCatalogOutletsFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requireAnyPermission('catalog.view', 'catalog.manage')])
  .handler(async ({ context }): Promise<OutletSummary[]> => {
    return listCatalogOutlets(context.auth)
  })

export const listFeatureFlagsFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requirePermission('flag.manage')])
  .handler(async ({ context }): Promise<FeatureFlagView[]> => {
    const rows = await listFeatureFlags(context.auth)
    return rows.map((r) => ({
      id: r.id,
      flagKey: r.flagKey,
      enabled: r.enabled,
      params: r.params as Record<string, FeatureFlagJson> | null,
      note: r.note,
    }))
  })
