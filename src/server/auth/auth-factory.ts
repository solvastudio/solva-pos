import '@tanstack/react-start/server-only'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import { authSchema, checkActiveMembership } from '~/modules/identity/public'
import { getDb } from '~/server/db'
import { requireAuthEnv } from '~/server/env'

function buildTenantCookiePrefix(slug: string): string {
  return `solva_s_${slug}`
}

export function getTenantSessionCookieName(slug: string): string {
  return `${buildTenantCookiePrefix(slug)}.session_token`
}

function createTenantAuthInstance(slug: string, tenantId: string, authOrgId: string) {
  const { BETTER_AUTH_SECRET, AUTH_COOKIE_SECURE } = requireAuthEnv()
  const normalizedSlug = slug.trim().toLowerCase()
  const cookiePrefix = buildTenantCookiePrefix(normalizedSlug)

  return betterAuth({
    secret: BETTER_AUTH_SECRET,
    basePath: `/${normalizedSlug}/admin/api/auth`,
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    plugins: [organization()],
    trustedOrigins: (request) => {
      if (!request) return []
      const url = new URL(request.url)
      const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
      const host = forwardedHost || request.headers.get('host')?.trim()
      const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
      const proto = forwardedProto || url.protocol.replace(/:$/, '') || 'http'
      return host ? [`${proto}://${host}`, url.origin] : [url.origin]
    },
    advanced: {
      cookiePrefix,
      // Keep cookie name prefix uniform (`solva_s_<slug>.session_token`) while
      // letting `AUTH_COOKIE_SECURE` control the `Secure` attribute.
      useSecureCookies: false,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        path: `/${normalizedSlug}`,
        secure: AUTH_COOKIE_SECURE,
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (sess) => {
            const active = await checkActiveMembership(tenantId, authOrgId, sess.userId)
            if (!active) {
              return false
            }
            return {
              data: {
                ...sess,
                activeOrganizationId: authOrgId,
              },
            }
          },
        },
      },
    },
  })
}

export type TenantAuthInstance = ReturnType<typeof createTenantAuthInstance>

const authInstances = new Map<string, TenantAuthInstance>()

export function createTenantAuth(
  slug: string,
  tenantId: string,
  authOrgId: string,
): TenantAuthInstance {
  const normalizedSlug = slug.trim().toLowerCase()
  const key = `${normalizedSlug}:${tenantId}:${authOrgId}`
  const existing = authInstances.get(key)
  if (existing) {
    return existing
  }
  const instance = createTenantAuthInstance(normalizedSlug, tenantId, authOrgId)
  authInstances.set(key, instance)
  return instance
}

export function __resetAuthInstancesForTests(): void {
  authInstances.clear()
}
