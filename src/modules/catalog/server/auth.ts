import '@tanstack/react-start/server-only'
import { runtimeIdGenerator } from '~/lib/runtime-id'
import { AppError } from '~/server/error-classify'

export interface CatalogActor {
  tenantId: string
  appUserId: string
  permissions: ReadonlySet<string>
  /** `null` grants tenant-wide outlet access; `string[]` restricts to listed outlets; `undefined` fails closed. */
  outletIds?: readonly string[] | null
}

export interface CatalogServiceDeps {
  nowIso?: () => string
  newId?: () => string
}

export const catalogIdGen = runtimeIdGenerator

export { nowIsoFrom } from '~/server/service-deps'

export function newIdFrom(deps?: CatalogServiceDeps): string {
  return (deps?.newId ?? (() => catalogIdGen.newId()))()
}

export function requireCatalogPermission(
  actor: CatalogActor,
  scope?: { requireTenantWide?: boolean; outletId?: string },
): void {
  if (!actor.permissions.has('catalog.manage')) {
    throw new AppError('FORBIDDEN', 'Missing required permission: catalog.manage')
  }
  if (!scope) {
    return
  }
  if (scope.requireTenantWide) {
    if (actor.outletIds !== null) {
      throw new AppError('FORBIDDEN', 'Tenant-wide outlet access required')
    }
    return
  }
  if (scope.outletId !== undefined) {
    if (actor.outletIds === null) {
      return
    }
    if (!Array.isArray(actor.outletIds) || !actor.outletIds.includes(scope.outletId)) {
      throw new AppError('FORBIDDEN', 'Outlet is outside your assigned scope')
    }
  }
}
