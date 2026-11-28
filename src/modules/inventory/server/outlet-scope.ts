import '@tanstack/react-start/server-only'
import { sql, type SQL } from 'drizzle-orm'
import type { IdentityAuthActor } from '~/modules/identity/public'
import { AppError } from '~/server/error-classify'

/** Outlet ids the actor may see, or `null` for tenant-wide access (an undefined scope fails closed). */
export function scopeOf(actor: IdentityAuthActor): readonly string[] | null {
  return actor.outletIds === null ? null : (actor.outletIds ?? [])
}

export function assertOutletInScope(scope: readonly string[] | null, outletId: string): void {
  if (scope !== null && !scope.includes(outletId)) {
    throw new AppError('FORBIDDEN', 'Outlet is outside your assigned scope')
  }
}

export function outletInScopeSql(column: SQL, scope: readonly string[]): SQL {
  if (scope.length === 0) {
    return sql`FALSE`
  }
  return sql`${column} = ANY(ARRAY[${sql.join(
    scope.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}])`
}
