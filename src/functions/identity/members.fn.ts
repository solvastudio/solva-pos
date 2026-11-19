import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  cancelInvite,
  createInvite,
  issueResetCode,
  listPendingInvites,
  reissueInvite,
  removeMember,
  type CreateInviteResult,
  type IssueResetCodeResult,
  type PendingInviteItem,
  type ReissueInviteResult,
} from '~/modules/identity/public'
import { authMiddleware } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware } from '../middleware'

const createInviteInputSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(1).max(80),
  roleId: z.string().uuid(),
  outletIds: z.array(z.string().uuid()).min(1).nullable(),
  existingAppUserId: z.string().uuid().optional(),
})

const appUserIdInputSchema = z.object({
  appUserId: z.string().uuid(),
})

export const createInviteFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => createInviteInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, authMiddleware])
  .handler(async ({ data, context }): Promise<CreateInviteResult> => {
    return createInvite(context.auth, data)
  })

export const listPendingInvitesFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, authMiddleware])
  .handler(async ({ context }): Promise<PendingInviteItem[]> => {
    return listPendingInvites(context.auth)
  })

export const cancelInviteFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => appUserIdInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await cancelInvite(context.auth, data.appUserId)
    return { ok: true }
  })

export const reissueInviteFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => appUserIdInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, authMiddleware])
  .handler(async ({ data, context }): Promise<ReissueInviteResult> => {
    return reissueInvite(context.auth, data.appUserId)
  })

export const issueResetCodeFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => appUserIdInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, authMiddleware])
  .handler(async ({ data, context }): Promise<IssueResetCodeResult> => {
    return issueResetCode(context.auth, data.appUserId)
  })

export const removeMemberFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => appUserIdInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await removeMember(context.auth, data.appUserId)
    return { ok: true }
  })
