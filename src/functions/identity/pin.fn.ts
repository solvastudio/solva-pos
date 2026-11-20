import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { resetPin, setPin } from '~/modules/identity/public'
import type { MutationActionResult } from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const pinMutationInputSchema = z.object({
  userId: z.string().uuid(),
  pin: z.string().min(1).max(12),
})

export const setPinFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => pinMutationInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({
      data,
      context,
    }): Promise<MutationActionResult<{ userId: string; pinEpoch: number }>> => {
      return runValidatedAction(() => setPin(context.auth, data))
    },
  )

export const resetPinFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => pinMutationInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(
    async ({
      data,
      context,
    }): Promise<MutationActionResult<{ userId: string; pinEpoch: number }>> => {
      return runValidatedAction(() => resetPin(context.auth, data))
    },
  )
