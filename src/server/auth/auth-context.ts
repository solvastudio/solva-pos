import '@tanstack/react-start/server-only'
import type { Locale } from '~/i18n/resolve-locale'
import { normalizeSlug, RESERVED_SLUGS, SLUG_PATTERN } from '~/lib/kernel'
import { getTenantAuthMetadataBySlug, loadMembership } from '~/modules/identity/public'
import type { PermissionCode } from '~/modules/identity/shared'
import { AppError } from '~/server/error-classify'
import { setContextField } from '~/server/logging/log-context'
import { createTenantAuth } from './auth-factory'

const RESERVED_SET = new Set<string>(RESERVED_SLUGS)

/**
 * Extracts the tenant slug for the current request.
 * Trusts `X-Tenant-Slug` injected by `src/server.ts` after stripping client-supplied
 * headers on non-rewritten requests, or falls back to the first URL path segment.
 */
export function extractRequestTenantSlug(request: Request): string | null {
  const trustedHeader = request.headers.get('x-tenant-slug')
  if (trustedHeader) {
    const normalized = normalizeSlug(trustedHeader)
    if (SLUG_PATTERN.test(normalized) && !RESERVED_SET.has(normalized)) {
      return normalized
    }
    return null
  }

  const pathname = new URL(request.url).pathname
  const firstSegment = pathname.split('/')[1]
  if (!firstSegment) {
    return null
  }
  const normalized = normalizeSlug(firstSegment)
  if (SLUG_PATTERN.test(normalized) && !RESERVED_SET.has(normalized)) {
    return normalized
  }
  return null
}

export function assertPermission(auth: AuthContext, code: PermissionCode): void {
  if (!auth.permissions.has(code)) {
    throw new AppError('FORBIDDEN', `Missing required permission: ${code}`)
  }
}

export interface AuthContext {
  tenantId: string
  tenantSlug: string
  authOrgId: string
  authUserId: string
  appUserId: string
  email: string
  displayName: string
  locale: Locale
  preferredLocale: Locale | null
  roleCodes: readonly string[]
  permissions: ReadonlySet<PermissionCode>
  outletIds: readonly string[] | null
  discountLimitPct: number
  sessionId: string
  sessionExpiresAt: string
}

/**
 * Resolves the authenticated Better Auth session for a tenant slug and loads the
 * caller's current RBAC membership. Always performs a live membership check so
 * suspended/removed users lose access immediately.
 */
export async function getAuthContext(request: Request, slug: string): Promise<AuthContext | null> {
  const meta = await getTenantAuthMetadataBySlug(slug)
  if (!meta || meta.status !== 'ACTIVE') {
    return null
  }

  const auth = createTenantAuth(meta.slug, meta.tenantId, meta.authOrgId)
  const sessionRes = await auth.api.getSession({
    headers: request.headers,
  })

  if (!sessionRes?.session || !sessionRes?.user) {
    return null
  }

  // Reject any cookie whose persisted session org does not match the target tenant.
  const activeOrgId = (sessionRes.session as { activeOrganizationId?: string | null })
    .activeOrganizationId
  if (!activeOrgId || activeOrgId !== meta.authOrgId) {
    return null
  }

  const membership = await loadMembership(meta.tenantId, sessionRes.user.id)
  if (!membership) {
    return null
  }

  setContextField('tenantId', meta.tenantId)
  setContextField('userId', membership.appUserId)

  const expiresAtRaw = sessionRes.session.expiresAt
  const sessionExpiresAt =
    expiresAtRaw instanceof Date ? expiresAtRaw.toISOString() : String(expiresAtRaw)

  return {
    tenantId: meta.tenantId,
    tenantSlug: meta.slug,
    authOrgId: meta.authOrgId,
    authUserId: sessionRes.user.id,
    appUserId: membership.appUserId,
    email: sessionRes.user.email,
    displayName: membership.displayName,
    locale: membership.effectiveLocale,
    preferredLocale: membership.preferredLocale,
    roleCodes: membership.roleCodes,
    permissions: new Set(membership.permissions),
    outletIds: membership.outletIds,
    discountLimitPct: membership.discountLimitPct,
    sessionId: sessionRes.session.id,
    sessionExpiresAt,
  }
}
