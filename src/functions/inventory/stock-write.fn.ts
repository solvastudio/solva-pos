import { createServerFn } from '@tanstack/react-start'
import {
  cancelStocktake,
  cancelTransferDraft,
  createStocktake,
  deleteSupplier,
  enableOutletTracking,
  postGr,
  postStocktake,
  receiveTransfer,
  reverseGr,
  saveGrDraft,
  saveStocktakeCounts,
  saveSupplier,
  saveTransferDraft,
  sendTransfer,
} from '~/modules/inventory/public'
import {
  grDraftSchema,
  grReverseSchema,
  idSchema,
  outletIdSchema,
  stocktakeCountsSchema,
  stocktakeCreateSchema,
  supplierSchema,
  transferDraftSchema,
  transferReceiveSchema,
} from '~/lib/contracts/inventory'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware } from '../middleware'

/** Write commands for inventory documents (SCR-A06). All business validation lives in the services, not here. */

export const saveGrDraftFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => grDraftSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => saveGrDraft(context.auth, { ...data, lines: data.lines.map((l) => ({ ...l, unitCost: l.unitCost ?? null, lineValue: l.lineValue ?? null })) }))

export const postGrFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => postGr(context.auth, data.id))

export const reverseGrFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => grReverseSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => reverseGr(context.auth, data.id, data.reasonText))

export const saveTransferDraftFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => transferDraftSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => saveTransferDraft(context.auth, data))

export const cancelTransferDraftFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => cancelTransferDraft(context.auth, data.id))

export const sendTransferFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => sendTransfer(context.auth, data.id))

export const receiveTransferFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => transferReceiveSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) =>
    receiveTransfer(context.auth, data.id, {
      lines: data.lines,
      closeReasonCode: data.closeReasonCode ?? null,
      closeReasonText: data.closeReasonText ?? null,
    }),
  )

export const createStocktakeFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => stocktakeCreateSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => createStocktake(context.auth, data))

export const saveStocktakeCountsFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => stocktakeCountsSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => saveStocktakeCounts(context.auth, data.id, data.counts))

export const postStocktakeFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => postStocktake(context.auth, data.id))

export const cancelStocktakeFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => cancelStocktake(context.auth, data.id))

export const enableOutletTrackingFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => outletIdSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('inventory.manage')])
  .handler(async ({ data, context }) => enableOutletTracking(context.auth, data.outletId))

export const saveSupplierFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => supplierSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('supplier.manage')])
  .handler(async ({ data, context }) => saveSupplier(context.auth, data))

export const deleteSupplierFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => idSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('supplier.manage')])
  .handler(async ({ data, context }) => deleteSupplier(context.auth, data.id))
