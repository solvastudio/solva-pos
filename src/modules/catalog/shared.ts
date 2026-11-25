import { z } from 'zod'

export const PRODUCT_TYPES = ['RETAIL', 'MENU_FNB'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const AVAILABILITY_STATUSES = ['AVAILABLE', 'UNAVAILABLE'] as const
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number]

export * from './domain/availability'
export * from './domain/price'
export * from './domain/price-adjust'
export * from './domain/recipe'
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

export interface CategoryView {
  id: string
  parentId: string | null
  name: string
  sortOrder: number
}

export interface UomView {
  id: string
  code: string
  name: string
  allowFraction: boolean
}

export interface ProductView {
  id: string
  categoryId: string
  code: string
  name: string
  productType: ProductType
  hasVariants: boolean
  baseUomId: string
  trackStock: boolean
  taxable: boolean
  isActive: boolean
  isOpenPrice: boolean
  sortOrder: number
}

export interface SkuView {
  id: string
  productId: string
  skuCode: string
  variantLabel: string | null
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

export interface SkuUomView {
  id: string
  skuId: string
  uomId: string
  conversionFactor: string
  isBase: boolean
  barcode: string | null
}

export interface PriceEntryView {
  id: string
  skuId: string
  uomId: string
  outletId: string | null
  price: number
  currency: string
}

export interface AvailabilityEntryView {
  id: string
  outletId: string
  productId: string
  skuId: string | null
  status: AvailabilityStatus
  changedAt: string
}

export interface OutletSummaryView {
  id: string
  code: string
  name: string
}

export interface AdminProductListItem {
  id: string
  code: string
  name: string
  categoryId: string
  categoryPath: string
  productType: ProductType
  skuCount: number
  priceRange: { min: number; max: number } | null
  availability: { available: number; total: number }
  isActive: boolean
}

export interface AdminProductListResult {
  items: AdminProductListItem[]
  total: number
  page: number
  pageSize: number
}

export interface AdminProductDetail {
  product: ProductView
  attributes: Array<{
    attribute: { id: string; productId: string; name: string; sortOrder: number }
    values: Array<{ id: string; attributeId: string; value: string; sortOrder: number }>
  }>
  skus: SkuView[]
  skuAttributeLinks: Array<{ skuId: string; attributeValueId: string }>
  skuUoms: SkuUomView[]
  prices: PriceEntryView[]
  availability: AvailabilityEntryView[]
  outlets: OutletSummaryView[]
}

export interface PriceMatrixRow {
  productId: string
  productCode: string
  productName: string
  categoryPath: string
  isOpenPrice: boolean
  skuId: string
  skuCode: string
  variantLabel: string | null
  uomId: string
  uomCode: string
  uomName: string
  isBase: boolean
  defaultPrice: number | null
  outletPrices: Record<string, number | null>
}

export interface PriceMatrixResult {
  rows: PriceMatrixRow[]
  outlets: OutletSummaryView[]
  canEditDefault: boolean
  total: number
  page: number
  pageSize: number
}

export interface AvailabilityMatrixRow {
  productId: string
  productCode: string
  productName: string
  categoryPath: string
  isActive: boolean
  skus: Array<{
    id: string
    skuCode: string
    variantLabel: string | null
    isActive: boolean
  }>
  productStatuses: Record<string, AvailabilityStatus>
  skuOverrides: Record<string, AvailabilityStatus>
  effectiveCounts: Record<string, { available: number; total: number }>
}

export interface AvailabilityMatrixResult {
  rows: AvailabilityMatrixRow[]
  outlets: OutletSummaryView[]
  scopedOutletIds: string[] | null
  total: number
  page: number
  pageSize: number
}

export type ImportKind = 'catalog' | 'price' | 'availability'

export type ImportRowErrorCode =
  | 'REQUIRED'
  | 'INVALID_FORMAT'
  | 'UNKNOWN_UOM'
  | 'UNKNOWN_OUTLET'
  | 'UNKNOWN_SKU'
  | 'UNKNOWN_PRODUCT'
  | 'DUPLICATE_BARCODE'
  | 'DUPLICATE_SKU_CODE'
  | 'CATEGORY_DEPTH'
  | 'VARIANT_LIMIT'
  | 'BASE_UOM_LOCKED'
  | 'PRICE_RANGE'
  | 'OUTLET_OUT_OF_SCOPE'

export interface RowError {
  row: number
  column: string
  code: ImportRowErrorCode
  messageKey: string
}

export interface EntityDiffCounts {
  create: number
  update: number
  unchanged: number
  deactivate?: number
}

export interface ImportReport {
  valid: boolean
  token?: string
  warnings: string[]
  errors: RowError[]
  totalErrors: number
  summary: Record<string, EntityDiffCounts>
}

export interface CommitImportResult {
  version: number | null
  versionBumped: boolean
  created: Record<string, number>
  updated: Record<string, number>
  unchanged: Record<string, number>
}

export type FeatureFlagJson =
  | string
  | number
  | boolean
  | null
  | FeatureFlagJson[]
  | { [key: string]: FeatureFlagJson }

export interface FeatureFlagView {
  id: string
  flagKey: string
  enabled: boolean
  params: Record<string, FeatureFlagJson> | null
  note: string | null
}

export interface ModifierIngredientView {
  id: string
  modifierId: string
  ingredientSkuId: string
  ingredientSkuCode: string
  ingredientProductName: string
  uomCode: string
  adjustType: 'ADD' | 'REDUCE' | 'REMOVE'
  qty: string | null
}

export interface ModifierView {
  id: string
  modifierGroupId: string
  name: string
  priceDelta: number
  isActive: boolean
  sortOrder: number
  version: number
  deletedAt: string | null
  ingredients: ModifierIngredientView[]
}

export interface ModifierGroupView {
  id: string
  name: string
  selectionType: 'SINGLE' | 'MULTI'
  minSelect: number
  maxSelect: number | null
  isActive: boolean
  version: number
  deletedAt: string | null
  modifiers: ModifierView[]
  linkedProductCount: number
}

export interface ModifierGroupProductView {
  id: string
  modifierGroupId: string
  productId: string
  sortOrder: number
  version: number
  deletedAt: string | null
}

export interface ProductModifierGroupView {
  linkId: string
  modifierGroupId: string
  name: string
  selectionType: 'SINGLE' | 'MULTI'
  minSelect: number
  maxSelect: number | null
  isActive: boolean
  sortOrder: number
  modifiers: ModifierView[]
  negativeDeltaWarning: boolean
}

export interface RecipeItemView {
  id: string
  menuSkuId: string
  ingredientSkuId: string
  ingredientSkuCode: string
  ingredientProductName: string
  ingredientTrackStock: boolean
  uomCode: string
  qty: string
  estimatedUnitCost: number | null
  estimatedLineCost: number | null
}

export interface IngredientOptionView {
  skuId: string
  skuCode: string
  productId: string
  productName: string
  productType: ProductType
  trackStock: boolean
  uomCode: string
}

export interface MenuRecipeResult {
  menuSkuId: string
  items: RecipeItemView[]
  estimatedTotalCost: number | null
  warnings: { code: 'INGREDIENT_NOT_TRACKED'; ingredientSkuId: string; message: string }[]
}
