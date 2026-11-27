import { z } from 'zod'
import { isPermissionCode, type PermissionCode } from './permissions'
import { ROLE_DISCOUNT_MAX, ROLE_DISCOUNT_MIN, ROLE_NAME_MAX_LENGTH } from './role-validation'

const roleNameSchema = z.string().trim().min(1).max(ROLE_NAME_MAX_LENGTH)
const roleDiscountSchema = z.number().min(ROLE_DISCOUNT_MIN).max(ROLE_DISCOUNT_MAX)
const rolePermissionsSchema = z
  .array(z.string().refine(isPermissionCode))
  .min(1, 'admin.users.role.permissionsRequired')

export const createRoleSchema = z.object({
  name: roleNameSchema,
  discountLimitPct: roleDiscountSchema,
  permissions: rolePermissionsSchema,
})

export const duplicateRoleSchema = z.object({
  sourceRoleId: z.string().uuid(),
  name: roleNameSchema,
})

export const updateRoleSchema = z.object({
  roleId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  name: roleNameSchema.optional(),
  discountLimitPct: roleDiscountSchema.optional(),
  permissions: rolePermissionsSchema.optional(),
})

export const deleteRoleSchema = z.object({
  roleId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
})

export const listRoleMembersSchema = z.object({
  roleId: z.string().uuid(),
})

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>
export type CreateRoleInput = z.infer<typeof createRoleSchema>
export type DuplicateRoleInput = z.infer<typeof duplicateRoleSchema>
export type DeleteRoleInput = z.infer<typeof deleteRoleSchema>
export type ListRoleMembersInput = z.infer<typeof listRoleMembersSchema>

export interface RoleMatrixView {
  id: string
  code: string
  name: string
  isSystem: boolean
  discountLimitPct: number
  permissions: readonly PermissionCode[]
  /** Distinct active members holding this role at any outlet. */
  memberCount: number
  /** True when the signed-in member holds this role (so cannot edit it). */
  heldByActor: boolean
  version: number
}

export interface RoleMemberView {
  appUserId: string
  displayName: string
}
