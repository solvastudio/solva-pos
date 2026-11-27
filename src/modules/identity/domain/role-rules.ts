import type { PermissionCode } from './permissions'

/** Codes present in only one of the two sets, sorted. */
export function diffPermissionCodes<T extends string = string>(
  current: ReadonlySet<T>,
  desired: ReadonlySet<T>,
): { added: T[]; removed: T[] } {
  return {
    added: [...desired].filter((code) => !current.has(code)).sort(),
    removed: [...current].filter((code) => !desired.has(code)).sort(),
  }
}

/** Codes from `codes` that the actor does not hold. */
export function permissionsActorLacks(
  codes: Iterable<string>,
  actorPermissions: ReadonlySet<PermissionCode>,
): string[] {
  return [...codes].filter((code) => !actorPermissions.has(code as PermissionCode))
}

/**
 * True when a role grants anything the actor does not hold, or a higher discount limit than the actor's.
 * Used to block privilege escalation when creating, duplicating, or assigning roles.
 */
export function roleExceedsActor(
  role: { permissions: Iterable<string>; discountLimitPct: number },
  actor: { permissions: ReadonlySet<PermissionCode>; discountLimitPct: number },
): boolean {
  return (
    permissionsActorLacks(role.permissions, actor.permissions).length > 0 ||
    role.discountLimitPct > actor.discountLimitPct
  )
}
