import { createServerFn } from '@tanstack/react-start'
import {
  createLegalEntity,
  createOutlet,
  listLegalEntities,
  listOutlets,
  updateLegalEntity,
  updateOutlet,
} from '~/modules/identity/public'
import {
  createOutletSchema,
  legalEntityFormSchema,
  normalizeNpwpInput,
  updateLegalEntitySchema,
  updateOutletSchema,
  type LegalEntityView,
  type MutationActionResult,
  type OutletView,
} from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

function parseLegalEntityCreateInput(raw: unknown) {
  const candidate = (raw ?? {}) as Record<string, unknown>
  return legalEntityFormSchema.parse({
    ...candidate,
    npwp:
      typeof candidate.npwp === 'string' && candidate.npwp.trim()
        ? normalizeNpwpInput(candidate.npwp)
        : null,
  })
}

function parseLegalEntityUpdateInput(raw: unknown) {
  const candidate = (raw ?? {}) as Record<string, unknown>
  return updateLegalEntitySchema.parse({
    ...candidate,
    npwp:
      typeof candidate.npwp === 'string' && candidate.npwp.trim()
        ? normalizeNpwpInput(candidate.npwp)
        : null,
  })
}

export const listLegalEntitiesFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ context }): Promise<LegalEntityView[]> => {
    return listLegalEntities(context.auth)
  })

export const createLegalEntityFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => parseLegalEntityCreateInput(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<LegalEntityView>> => {
    return runValidatedAction(() => createLegalEntity(context.auth, data))
  })

export const updateLegalEntityFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => parseLegalEntityUpdateInput(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<LegalEntityView>> => {
    return runValidatedAction(() => updateLegalEntity(context.auth, data))
  })

export const listOutletsFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ context }): Promise<OutletView[]> => {
    return listOutlets(context.auth)
  })

export const createOutletFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => createOutletSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<OutletView>> => {
    return runValidatedAction(() => createOutlet(context.auth, data))
  })

export const updateOutletFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => updateOutletSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<OutletView>> => {
    return runValidatedAction(() => updateOutlet(context.auth, data))
  })
