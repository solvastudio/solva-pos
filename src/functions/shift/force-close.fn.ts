import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { MutationActionResult } from '~/modules/identity/shared'
import { forceCloseShift } from '~/modules/shift/public'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const forceCloseInputSchema = z.object({
  shiftId: z.string().uuid(),
  countedCash: z.number().int().min(0),
  reasonText: z.string().trim().min(1).max(500),
})

export const forceCloseShiftFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => forceCloseInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('shift.force_close')])
  .handler(
    async ({
      data,
      context,
    }): Promise<MutationActionResult<{ shiftId: string; status: 'FORCE_CLOSED' }>> => {
      return runValidatedAction(() => forceCloseShift(context.auth, data))
    },
  )
