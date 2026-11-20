import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { DEVICE_REVOKE_REASONS, type MutationActionResult } from '~/modules/identity/shared'
import {
  previewRegisterRecovery,
  recoverRegister,
  type RecoverRegisterPreview,
  type RecoverRegisterResult,
} from '~/modules/sales/public'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const previewRecoveryInputSchema = z.object({
  registerId: z.string().uuid(),
  declaredLastInvoiceSeq: z.number().int().nonnegative().nullable().optional(),
  declaredLastCreditSeq: z.number().int().nonnegative().nullable().optional(),
})

const recoverRegisterInputSchema = previewRecoveryInputSchema.extend({
  reasonCode: z.enum(DEVICE_REVOKE_REASONS).optional(),
  reasonText: z.string().trim().max(500).nullable().optional(),
})

export const previewRecoveryFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => previewRecoveryInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<RecoverRegisterPreview>> => {
    return runValidatedAction(() => previewRegisterRecovery(context.auth, data))
  })

export const recoverRegisterFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => recoverRegisterInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<RecoverRegisterResult>> => {
    return runValidatedAction(() => recoverRegister(context.auth, data))
  })
