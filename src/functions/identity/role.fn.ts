import { createServerFn } from '@tanstack/react-start'
import {
  createRole,
  deleteRole,
  duplicateRole,
  listRolesWithPermissions,
  updateRole,
} from '~/modules/identity/public'
import {
  createRoleSchema,
  deleteRoleSchema,
  duplicateRoleSchema,
  updateRoleSchema,
  type MutationActionResult,
  type RoleMatrixView,
} from '~/modules/identity/shared'
import { authMiddleware, requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

export const listRolesWithPermissionsFn = createServerFn({ method: 'GET' })
  .middleware([publicErrorMiddleware, authMiddleware])
  .handler(async ({ context }): Promise<RoleMatrixView[]> => {
    return listRolesWithPermissions(context.auth)
  })

export const createRoleFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => createRoleSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('role.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<RoleMatrixView>> => {
    return runValidatedAction(() => createRole(context.auth, data))
  })

export const duplicateRoleFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => duplicateRoleSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('role.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<RoleMatrixView>> => {
    return runValidatedAction(() => duplicateRole(context.auth, data))
  })

export const updateRoleFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => updateRoleSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('role.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<RoleMatrixView>> => {
    return runValidatedAction(() => updateRole(context.auth, data))
  })

export const deleteRoleFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => deleteRoleSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('role.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<{ id: string }>> => {
    return runValidatedAction(() => deleteRole(context.auth, data))
  })
