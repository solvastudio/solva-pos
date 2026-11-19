import { createServerFn } from '@tanstack/react-start'
import { listRolesWithPermissions, updateRole } from '~/modules/identity/public'
import {
  updateRoleSchema,
  type MutationActionResult,
  type RoleMatrixView,
} from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

export const listRolesWithPermissionsFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ context }): Promise<RoleMatrixView[]> => {
    return listRolesWithPermissions(context.auth)
  })

export const updateRoleFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => updateRoleSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('user.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<RoleMatrixView>> => {
    return runValidatedAction(() => updateRole(context.auth, data))
  })
