import { createServerFn } from '@tanstack/react-start'
import {
  changeInvoicePrefix,
  createRegister,
  listRegisters,
  updateRegister,
} from '~/modules/identity/public'
import {
  changeInvoicePrefixSchema,
  createRegisterSchema,
  updateRegisterSchema,
  type MutationActionResult,
  type RegisterView,
} from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

export const listRegistersFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ context }): Promise<RegisterView[]> => {
    return listRegisters(context.auth)
  })

export const createRegisterFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => createRegisterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<RegisterView>> => {
    return runValidatedAction(() => createRegister(context.auth, data))
  })

export const updateRegisterFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => updateRegisterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<RegisterView>> => {
    return runValidatedAction(() => updateRegister(context.auth, data))
  })

export const changeInvoicePrefixFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => changeInvoicePrefixSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<RegisterView>> => {
    return runValidatedAction(() => changeInvoicePrefix(context.auth, data))
  })
