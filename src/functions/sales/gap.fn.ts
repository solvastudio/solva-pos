import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { MutationActionResult } from '~/modules/identity/shared'
import { annotateGap, listGaps, type InvoiceGapRow } from '~/modules/sales/public'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const listGapsFilterSchema = z
  .object({
    outletId: z.string().uuid().optional(),
    status: z.enum(['OPEN', 'EXPLAINED', 'FILLED']).optional(),
  })
  .optional()

const annotateGapSchema = z.object({
  gapId: z.string().uuid(),
  reasonCode: z.string().trim().max(40).nullable().optional(),
  reasonText: z.string().trim().min(1).max(500),
})

export const listGapsFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => listGapsFilterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('gap.annotate')])
  .handler(async ({ data, context }): Promise<InvoiceGapRow[]> => {
    return listGaps(context.auth, data)
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
          reasonCode: data.reasonCode,
          reasonText: data.reasonText,
        }),
      )
    },
  )
