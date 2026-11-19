import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { changeMemberRoleAndOutlets, listMembers } from '~/modules/identity/public'
import {
  changeMemberRoleAndOutletsSchema,
  type MemberDirectoryView,
  type MutationActionResult,
} from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const listMembersFilterSchema = z
  .object({
    search: z.string().max(120).optional(),
    roleId: z.string().uuid().optional(),
    outletId: z.string().uuid().optional(),
  })
  .optional()

export const listMembersFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => listMembersFilterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MemberDirectoryView[]> => {
    return listMembers(context.auth, data)
  })

export const changeMemberRoleAndOutletsFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => changeMemberRoleAndOutletsSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<MemberDirectoryView>> => {
    return runValidatedAction(() => changeMemberRoleAndOutlets(context.auth, data))
  })
