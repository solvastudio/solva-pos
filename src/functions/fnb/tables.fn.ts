import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { createFnbTableSchema, updateFnbTableSchema } from '~/lib/contracts'
import {
  createTable,
  deactivateOrDeleteTable,
  listTables,
  updateTable,
  type FnbTableRow,
} from '~/modules/fnb/public'
import type { FnbTableView } from '~/modules/fnb/shared'
import type { MutationActionResult } from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const listTablesInputSchema = z.object({
  outletId: z.string().uuid().optional(),
})

const tableIdSchema = z.object({
  id: z.string().uuid(),
})

export const listTablesFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => listTablesInputSchema.parse(raw ?? {}))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<FnbTableView[]> => {
    return listTables(context.auth, data.outletId)
  })

export const createTableFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => createFnbTableSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<FnbTableRow>> => {
    return runValidatedAction(() => createTable(context.auth, data))
  })

export const updateTableFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => updateFnbTableSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<FnbTableRow>> => {
    return runValidatedAction(() => updateTable(context.auth, data))
  })

export const deleteOrDeactivateTableFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => tableIdSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(
    async ({
      data,
      context,
    }): Promise<MutationActionResult<{ mode: 'deleted' | 'deactivated'; table: FnbTableRow }>> => {
      return runValidatedAction(() => deactivateOrDeleteTable(context.auth, data.id))
    },
  )
