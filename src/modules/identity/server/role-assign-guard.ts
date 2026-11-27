import '@tanstack/react-start/server-only'
import type { TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { roleExceedsActor } from '../domain/role-rules'
import type { IdentityAuthActor } from './code-crypto'
import { listActiveRolesOfUser } from './member-directory.repo'
import { listRoleLimitsByIds, listRolePermissionRowsForRoles } from './role.repo'

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

  const targetList = [...targetIds]
  const limits = await listRoleLimitsByIds(tx, actor.tenantId, targetList)
  const permRows = await listRolePermissionRowsForRoles(tx, actor.tenantId, targetList)
  const actorRoles = await listActiveRolesOfUser(tx, actor.tenantId, actor.appUserId)
  const actorDiscountLimitPct = Math.max(0, ...actorRoles.map((r) => r.discountLimitPct))

  const permsByRole = new Map<string, string[]>()
  for (const p of permRows) {
    const list = permsByRole.get(p.roleId) ?? []
    list.push(p.permissionCode)
    permsByRole.set(p.roleId, list)
  }

  // Roles that no longer exist are skipped: callers validate existence separately.
  for (const target of limits) {
    if (
      roleExceedsActor(
        {
          permissions: permsByRole.get(target.id) ?? [],
          discountLimitPct: Number(target.discountLimitPct),
        },
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
