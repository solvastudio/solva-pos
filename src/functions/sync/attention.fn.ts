import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { MutationActionResult } from '~/modules/identity/shared'
import { annotateGap, listGaps } from '~/modules/sales/public'
import type { InvoiceGapRow } from '~/modules/sales/shared'
import {
  acceptManual,
  dismissAttention,
  escalateAttention,
  importPendingFile,
  listAttention,
} from '~/modules/sync/public'
import type { AttentionItemView, PendingImportResult } from '~/modules/sync/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const listAttentionSchema = z
  .object({
    status: z.enum(['OPEN', 'ESCALATED', 'ACCEPTED', 'DISMISSED', 'ALL']).optional(),
    outletId: z.string().uuid().nullable().optional(),
  })
  .optional()

const acceptManualSchema = z.object({
  itemId: z.string().uuid(),
})

const dismissSchema = z.object({
  itemId: z.string().uuid(),
  reasonText: z.string().trim().min(1).max(500),
})

const escalateSchema = z.object({
  itemId: z.string().uuid(),
  note: z.string().max(500).nullable().optional(),
})

const importPendingSchema = z.object({
  fileText: z.string().min(1).max(5 * 1024 * 1024),
})

const listGapsSchema = z
  .object({
    outletId: z.string().uuid().optional(),
    status: z.enum(['OPEN', 'EXPLAINED', 'FILLED']).optional(),
  })
  .optional()

const annotateGapSchema = z.object({
  gapId: z.string().uuid(),
  reasonCode: z.string().max(40).nullable().optional(),
  reasonText: z.string().trim().min(1).max(500),
})

export const listAttentionFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => listAttentionSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<AttentionItemView[]> => {
    return listAttention(context.auth, data ?? {})
  })

export const acceptManualAttentionFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => acceptManualSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({
      data,
      context,
    }): Promise<MutationActionResult<{ id: string; status: 'ACCEPTED'; replay: boolean }>> => {
      return runValidatedAction(() => acceptManual(context.auth, data.itemId))
    },
  )

export const dismissAttentionFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => dismissSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({
      data,
      context,
    }): Promise<MutationActionResult<{ id: string; status: 'DISMISSED' }>> => {
      return runValidatedAction(() =>
        dismissAttention(context.auth, data.itemId, data.reasonText),
      )
    },
  )

export const escalateAttentionFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => escalateSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({
      data,
      context,
    }): Promise<MutationActionResult<{ id: string; status: 'ESCALATED' }>> => {
      return runValidatedAction(() =>
        escalateAttention(context.auth, data.itemId, data.note ?? null),
      )
    },
  )

export const importPendingFileFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => importPendingSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({ data, context }): Promise<MutationActionResult<PendingImportResult>> => {
      return runValidatedAction(() =>
        importPendingFile(context.auth, { fileText: data.fileText }),
      )
    },
  )

export const listGapsFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => listGapsSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('gap.annotate')])
  .handler(async ({ data, context }): Promise<InvoiceGapRow[]> => {
    return listGaps(context.auth, data ?? {})
  })

export const annotateGapFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => annotateGapSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('gap.annotate')])
  .handler(
    async ({
      data,
      context,
    }): Promise<MutationActionResult<{ id: string; status: 'EXPLAINED' }>> => {
      return runValidatedAction(() =>
        annotateGap(context.auth, data.gapId, {
          reasonCode: data.reasonCode ?? null,
          reasonText: data.reasonText,
        }),
      )
    },
  )
