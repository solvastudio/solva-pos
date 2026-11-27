import '@tanstack/react-start/server-only'
import type { TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { roleExceedsActor } from '../domain/role-rules'
import type { IdentityAuthActor } from './code-crypto'
import { listActorRoleRows, listRolePermissionRows, listRolesRows } from './role.repo'

/**
 * Rejects (`FORBIDDEN`) when any of `roleIds` grants more than the actor holds: a permission the actor
 * lacks, or a higher discount limit than the actor's own highest limit.
 */
export async function assertActorMayAssignRoles(
  tx: TenantTx,
  actor: IdentityAuthActor,
  roleIds: Iterable<string>,
): Promise<void> {
  const targetIds = new Set(roleIds)
  if (targetIds.size === 0) {
    return
  }

  const roles = await listRolesRows(tx, actor.tenantId)
  const permRows = await listRolePermissionRows(tx, actor.tenantId)
  const actorRoles = await listActorRoleRows(tx, actor.tenantId, actor.appUserId)
  const actorDiscountLimitPct = Math.max(0, ...actorRoles.map((r) => r.discountLimitPct))

  for (const targetId of targetIds) {
    const target = roles.find((r) => r.id === targetId)
    if (!target) {
      continue
    }
    const permissions = permRows.filter((p) => p.roleId === targetId).map((p) => p.permissionCode)
    if (
      roleExceedsActor(
        { permissions, discountLimitPct: Number(target.discountLimitPct) },
        { permissions: actor.permissions, discountLimitPct: actorDiscountLimitPct },
      )
    ) {
      throw new AppError(
        'FORBIDDEN',
        'Cannot assign a role that exceeds your own permissions or discount limit',
      )
    }
  }
}
