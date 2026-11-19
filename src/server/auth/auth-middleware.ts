import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { PermissionCode } from '~/modules/identity/shared'
import { AppError } from '~/server/error-classify'
import {
  assertPermission,
  extractRequestTenantSlug,
  getAuthContext,
} from './auth-context'

/**
 * Server function middleware that authenticates the caller for the current tenant slug,
 * loads live RBAC membership from PostgreSQL, and injects `{ auth }` into context.
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const request = getRequest()
  const slug = extractRequestTenantSlug(request)
  if (!slug) {
    throw new AppError('UNAUTHORIZED', 'Missing tenant context')
  }

  const auth = await getAuthContext(request, slug)
  if (!auth) {
    throw new AppError('UNAUTHORIZED', 'Authentication required')
  }

  return next({
    context: { auth },
  })
})

export function requirePermission(code: PermissionCode) {
  return createMiddleware({ type: 'function' })
    .middleware([authMiddleware])
    .server(async ({ next, context }) => {
      assertPermission(context.auth, code)
      return next({
        context: { auth: context.auth },
      })
    })
}
