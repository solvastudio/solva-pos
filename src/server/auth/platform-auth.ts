import '@tanstack/react-start/server-only'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth'
import { platformAuthSchema } from '~/modules/identity/public'
import { getDb } from '~/server/db'
import { getPublicBaseUrl, requireAuthEnv } from '~/server/env'
import { getTrustedOrigins } from './origin-check'

function createPlatformAuthInstance() {
  const { BETTER_AUTH_SECRET, AUTH_COOKIE_SECURE } = requireAuthEnv()

  return betterAuth({
    secret: BETTER_AUTH_SECRET,
    baseURL: getPublicBaseUrl(),
    basePath: '/platform/api/auth',
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: platformAuthSchema,
    }),
    user: { modelName: 'platform_user' },
    session: {
      modelName: 'platform_session',
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 30,
    },
    account: { modelName: 'platform_account' },
    verification: { modelName: 'platform_verification' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    rateLimit: {
      enabled: false,
    },
    trustedOrigins: (request) => getTrustedOrigins(request),
    advanced: {
      cookiePrefix: 'solva_platform',
      useSecureCookies: false,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: AUTH_COOKIE_SECURE,
        sameSite: 'lax',
        path: '/platform',
      },
    },
  })
}

export type PlatformAuthInstance = ReturnType<typeof createPlatformAuthInstance>

let cachedPlatformAuth: PlatformAuthInstance | null = null

export function getPlatformAuth(): PlatformAuthInstance {
  if (!cachedPlatformAuth) {
    cachedPlatformAuth = createPlatformAuthInstance()
  }
  return cachedPlatformAuth
}

export function __resetPlatformAuthForTests(): void {
  cachedPlatformAuth = null
}
