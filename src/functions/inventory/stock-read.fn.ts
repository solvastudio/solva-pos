import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { r02FilterSchema, idSchema } from '~/lib/contracts/inventory'
import {
  getStocktake,
  getTransfer,
  listGr,
  listSkuOptions,
  listStocktakes,
  listSuppliers,
  listTransferDestinations,
  listTransfers,
  reportR02,
} from '~/modules/inventory/public'
import { requireAnyPermission, requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware } from '../middleware'

/** Read inventory documents and the R-02 report (SCR-A06). */

const optionalOutlet = z.object({ outletId: z.string().uuid().optional() })

export const getStockReportFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => r02FilterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('report.view')])
  .handler(async ({ data, context }) => reportR02(context.auth, data))

export const listGrFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => optionalOutlet.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => listGr(context.auth, data))

export const listTransfersFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => optionalOutlet.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => listTransfers(context.auth, data))

export const listTransferDestinationsFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ context }) => listTransferDestinations(context.auth))

export const listStocktakesFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => optionalOutlet.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => listStocktakes(context.auth, data))

export const getStocktakeFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => idSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => getStocktake(context.auth, data.id))

export const getTransferFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => idSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => getTransfer(context.auth, data.id))

export const listSkuOptionsFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ context }) => listSkuOptions(context.auth))

export const listSuppliersFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => z.object({ includeInactive: z.boolean().optional() }).parse(raw ?? {}))
  .middleware([publicErrorMiddleware, requireAnyPermission('inventory.manage', 'supplier.manage')])
  .handler(async ({ data, context }) => listSuppliers(context.auth, data))
