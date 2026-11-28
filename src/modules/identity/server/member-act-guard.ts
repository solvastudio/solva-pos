import '@tanstack/react-start/server-only'
import type { TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import type { IdentityAuthActor } from './code-crypto'
import { listMemberOutletAssignments } from './member-directory.repo'
import { assertActorMayAssignRoles } from './role-assign-guard'

/**
 * Guards member-level actions (invite lifecycle, removal, password reset).
 * The target must sit entirely inside the actor's outlet scope, and none of the target's roles
 * may exceed the actor's own permissions or discount limit.
 */
export async function assertActorMayActOnMember(
  tx: TenantTx,
  actor: IdentityAuthActor,
  appUserId: string,
): Promise<void> {
  const assignments = await listMemberOutletAssignments(tx, actor.tenantId, appUserId)

  if (actor.outletIds !== null) {
    const allowed = new Set(actor.outletIds ?? [])
    const inside =
      assignments.length > 0 &&
      assignments.every((a) => a.outletId !== null && allowed.has(a.outletId))
    if (!inside) {
      throw new AppError('FORBIDDEN', 'Target member is outside your outlet scope')
    }
  }

  await assertActorMayAssignRoles(
    tx,
    actor,
    assignments.map((a) => a.roleId),
  )
}
