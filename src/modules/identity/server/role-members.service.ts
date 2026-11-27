import '@tanstack/react-start/server-only'
import { withTenantReadOnly } from '~/server/db'
import { parseOrThrow } from '~/server/parse-or-throw'
import { listRoleMembersSchema, type ListRoleMembersInput, type RoleMemberView } from '../shared'
import { requireActorPermission, type IdentityAuthActor } from './code-crypto'
import { listRoleMemberRows } from './member-directory.repo'

/** Names of the members holding one role, limited to the actor's outlet scope. */
export async function listRoleMembers(
  actor: IdentityAuthActor,
  rawInput: ListRoleMembersInput,
): Promise<RoleMemberView[]> {
  requireActorPermission(actor, 'user.manage')
  const parsed = parseOrThrow(listRoleMembersSchema, rawInput, 'Invalid role members input')
  // An undefined outlet scope fails closed, like the other scoped member queries.
  const outletIds = actor.outletIds === undefined ? [] : actor.outletIds
  return withTenantReadOnly(actor.tenantId, (tx) =>
    listRoleMemberRows(tx, actor.tenantId, parsed.roleId, outletIds),
  )
}
