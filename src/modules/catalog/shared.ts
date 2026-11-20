import { z } from 'zod'

export const PRODUCT_TYPES = ['RETAIL', 'MENU_FNB'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const AVAILABILITY_STATUSES = ['AVAILABLE', 'UNAVAILABLE'] as const
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number]

export * from './domain/availability'
export * from './domain/price'
export * from './domain/search-tokens'
export * from './domain/variants'

export const createCategorySchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().default(0),
})

export const updateCategorySchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  sortOrder: z.number().int().optional(),
})

export const createUomSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9]{1,12}$/),
  name: z.string().trim().min(1).max(80),
  allowFraction: z.boolean().default(false),
})

export const updateUomSchema = z.object({
  id: z.string().uuid(),
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9]{1,12}$/)
    .optional(),
  name: z.string().trim().min(1).max(80).optional(),
  allowFraction: z.boolean().optional(),
})

export const attributeInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  values: z.array(z.string().trim().min(1).max(40)).min(1),
})

export const createProductSchema = z.object({
  categoryId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9\-_.]{1,30}$/),
  name: z.string().trim().min(1).max(160),
  productType: z.enum(PRODUCT_TYPES).default('RETAIL'),
  hasVariants: z.boolean().default(false),
  baseUomId: z.string().uuid(),
  trackStock: z.boolean().default(true),
  taxable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  isOpenPrice: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  barcode: z.string().trim().min(1).max(64).nullable().optional(),
  attributes: z.array(attributeInputSchema).max(3).optional(),
  excludeOutletIds: z.array(z.string().uuid()).optional(),
})

export const updateProductSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9\-_.]{1,30}$/)
    .optional(),
  name: z.string().trim().min(1).max(160).optional(),
  baseUomId: z.string().uuid().optional(),
  trackStock: z.boolean().optional(),
  taxable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isOpenPrice: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export type CreateCategoryInput = z.input<typeof createCategorySchema>
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>
export type CreateUomInput = z.input<typeof createUomSchema>
export type UpdateUomInput = z.input<typeof updateUomSchema>
export type CreateProductInput = z.input<typeof createProductSchema>
export type UpdateProductInput = z.input<typeof updateProductSchema>
