import { z } from 'zod'

function cleanOptionalString(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined
  const trimmed = val.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function cleanPage(val: unknown): number {
  const n = typeof val === 'string' ? Number(val) : typeof val === 'number' ? val : 1
  return Number.isSafeInteger(n) && n >= 1 ? n : 1
}

function cleanBoolean(val: unknown): boolean {
  return val === true || val === 'true' || val === '1'
}

export const productListSearchSchema = z.object({
  q: z.preprocess(cleanOptionalString, z.string().max(100).optional()),
  categoryId: z.preprocess(cleanOptionalString, z.string().uuid().optional()),
  type: z
    .preprocess(
      (v) => (v === 'RETAIL' || v === 'MENU_FNB' ? v : 'ALL'),
      z.enum(['ALL', 'RETAIL', 'MENU_FNB']),
    )
    .default('ALL'),
  page: z.preprocess(cleanPage, z.number().int().min(1)).default(1),
})

export const priceMatrixSearchSchema = z.object({
  q: z.preprocess(cleanOptionalString, z.string().max(100).optional()),
  categoryId: z.preprocess(cleanOptionalString, z.string().uuid().optional()),
  onlyMissing: z.preprocess(cleanBoolean, z.boolean()).default(false),
  page: z.preprocess(cleanPage, z.number().int().min(1)).default(1),
})

export const availabilityMatrixSearchSchema = z.object({
  q: z.preprocess(cleanOptionalString, z.string().max(100).optional()),
  categoryId: z.preprocess(cleanOptionalString, z.string().uuid().optional()),
  onlyExceptions: z.preprocess(cleanBoolean, z.boolean()).default(false),
  page: z.preprocess(cleanPage, z.number().int().min(1)).default(1),
})

export type ProductListSearch = z.infer<typeof productListSearchSchema>
export type PriceMatrixSearch = z.infer<typeof priceMatrixSearchSchema>
export type AvailabilityMatrixSearch = z.infer<typeof availabilityMatrixSearchSchema>
