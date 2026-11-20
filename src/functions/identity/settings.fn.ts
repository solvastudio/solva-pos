import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  addTaxRate,
  getOutletFullSettings,
  listPaymentMethods,
  savePaymentMethod,
  updateOutletTaxSettings,
  updateReceiptSetting,
  uploadOutletLogo,
} from '~/modules/identity/public'
import {
  addTaxRateSchema,
  savePaymentMethodSchema,
  updateOutletTaxSettingsSchema,
  updateReceiptSettingSchema,
  uploadOutletLogoSchema,
  type MutationActionResult,
  type OutletReceiptSettingView,
  type OutletTaxSettingsView,
  type PaymentMethodView,
  type TaxRateHistoryView,
} from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const outletIdParamSchema = z.object({
  outletId: z.string().uuid(),
})

export const getOutletFullSettingsFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => outletIdParamSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      tax: OutletTaxSettingsView
      receipt: OutletReceiptSettingView | null
      taxRates: TaxRateHistoryView[]
      paymentMethods: PaymentMethodView[]
    }> => {
      return getOutletFullSettings(context.auth, data.outletId)
    },
  )

export const updateOutletTaxSettingsFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => updateOutletTaxSettingsSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ version: number }>> => {
    return runValidatedAction(() => updateOutletTaxSettings(context.auth, data))
  })

export const addTaxRateFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => addTaxRateSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({ data, context }): Promise<MutationActionResult<{ id: string; version: number }>> => {
      return runValidatedAction(() => addTaxRate(context.auth, data))
    },
  )

export const updateReceiptSettingFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => updateReceiptSettingSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({ data, context }): Promise<MutationActionResult<{ id: string; version: number }>> => {
      return runValidatedAction(() => updateReceiptSetting(context.auth, data))
    },
  )

export const uploadOutletLogoFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => uploadOutletLogoSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({
      data,
      context,
    }): Promise<
      MutationActionResult<{
        logoObjectKey: string
        logoSha256: string
        width: number
        height: number
        version: number
      }>
    > => {
      return runValidatedAction(() => uploadOutletLogo(context.auth, data))
    },
  )

export const listPaymentMethodsFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ context }): Promise<PaymentMethodView[]> => {
    return listPaymentMethods(context.auth)
  })

export const savePaymentMethodFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => savePaymentMethodSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({ data, context }): Promise<MutationActionResult<{ id: string; version: number }>> => {
      return runValidatedAction(() => savePaymentMethod(context.auth, data))
    },
  )
