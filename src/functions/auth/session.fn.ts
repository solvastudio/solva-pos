import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import type { Locale } from '~/i18n/resolve-locale'
import { normalizeSlug } from '~/lib/kernel'
import { setAppUserPreferredLocale } from '~/modules/identity/public'
import type { PermissionCode } from '~/modules/identity/shared'
import { extractRequestTenantSlug, getAuthContext } from '~/server/auth/auth-context'
import { authMiddleware } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware } from '../middleware'

export interface AdminSessionView {
  tenantId: string
  tenantSlug: string
  appUserId: string
  email: string
  displayName: string
  locale: Locale
  preferredLocale: Locale | null
  roleCodes: readonly string[]
  permissions: readonly PermissionCode[]
  outletIds: readonly string[] | null
  discountLimitPct: number
  sessionExpiresAt: string
}

const getSessionInputSchema = z
  .object({
    slug: z.string().max(64).optional(),
  })
  .optional()

export const getSessionFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => getSessionInputSchema.parse(raw))
  .middleware([publicErrorMiddleware])
  .handler(async ({ data }): Promise<AdminSessionView | null> => {
    const request = getRequest()
    const requestSlug = extractRequestTenantSlug(request)
    const slug = requestSlug ?? (data?.slug ? normalizeSlug(data.slug) : null)
    if (!slug) {
      return null
    }
    if (data?.slug && requestSlug && normalizeSlug(data.slug) !== requestSlug) {
      return null
    }

    const ctx = await getAuthContext(request, slug)
    if (!ctx) {
      return null
    }

    return {
      tenantId: ctx.tenantId,
      tenantSlug: ctx.tenantSlug,
      appUserId: ctx.appUserId,
      email: ctx.email,
      displayName: ctx.displayName,
      locale: ctx.locale,
      preferredLocale: ctx.preferredLocale,
      roleCodes: ctx.roleCodes,
      permissions: [...ctx.permissions],
      outletIds: ctx.outletIds,
      discountLimitPct: ctx.discountLimitPct,
      sessionExpiresAt: ctx.sessionExpiresAt,
    }
  })

const setLocaleInputSchema = z.object({
  locale: z.enum(['id-ID', 'en-US']),
})

export const setPreferredLocaleFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => setLocaleInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, authMiddleware])
  .handler(async ({ data, context }): Promise<{ locale: Locale }> => {
    await setAppUserPreferredLocale(context.auth.tenantId, context.auth.appUserId, data.locale)
    return { locale: data.locale }
  })
