import { z } from 'zod'

export interface TaxRateHistoryView {
  readonly id: string
  readonly taxCode: 'PPN' | 'PB1'
  readonly outletId: string | null
  readonly effectiveFrom: string
  readonly rate: string
  readonly version: number
}

export interface OutletReceiptSettingView {
  readonly id: string
  readonly outletId: string
  readonly receiptLocale: 'id-ID' | 'en-US'
  readonly headerText: string | null
  readonly footerText: string | null
  readonly logoSha256: string | null
  readonly version: number
}

export interface PaymentMethodView {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly kind: 'CASH' | 'NON_CASH'
  readonly requiresReference: boolean
  readonly sortOrder: number
  readonly isActive: boolean
  readonly version: number
}

export interface OutletTaxSettingsView {
  readonly outletId: string
  readonly legalEntityIsPkp: boolean
  readonly taxProfile: 'NONE' | 'PPN' | 'PB1'
  readonly priceTaxMode: 'INCLUSIVE' | 'EXCLUSIVE'
  readonly cashRoundingUnit: 0 | 100 | 500 | 1000
  readonly serviceChargeEnabled: boolean
  readonly serviceChargeRate: string
  readonly serviceChargeTaxable: boolean
  readonly timezone: string
  readonly dayCutoffTime: string
  readonly version: number
}

export const updateOutletTaxSettingsSchema = z.object({
  outletId: z.string().uuid(),
  taxProfile: z.enum(['NONE', 'PPN', 'PB1']),
  priceTaxMode: z.enum(['INCLUSIVE', 'EXCLUSIVE']),
  cashRoundingUnit: z.union([z.literal(0), z.literal(100), z.literal(500), z.literal(1000)]),
  serviceChargeEnabled: z.boolean(),
  serviceChargeRate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/),
  serviceChargeTaxable: z.boolean(),
})

export const addTaxRateSchema = z.object({
  taxCode: z.enum(['PPN', 'PB1']),
  outletId: z.string().uuid().nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/),
})

export const updateReceiptSettingSchema = z.object({
  outletId: z.string().uuid(),
  receiptLocale: z.enum(['id-ID', 'en-US']),
  headerText: z.string().max(600).nullable(),
  footerText: z.string().max(600).nullable(),
})

export const savePaymentMethodSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().regex(/^[A-Z0-9_]{2,20}$/),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['CASH', 'NON_CASH']),
  requiresReference: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  isActive: z.boolean(),
})

export const uploadOutletLogoSchema = z.object({
  outletId: z.string().uuid(),
  base64Data: z.string().min(8).max(400_000),
})

export type UpdateOutletTaxSettingsInput = z.infer<typeof updateOutletTaxSettingsSchema>
export type AddTaxRateInput = z.infer<typeof addTaxRateSchema>
export type UpdateReceiptSettingInput = z.infer<typeof updateReceiptSettingSchema>
export type SavePaymentMethodInput = z.infer<typeof savePaymentMethodSchema>
export type UploadOutletLogoInput = z.infer<typeof uploadOutletLogoSchema>
