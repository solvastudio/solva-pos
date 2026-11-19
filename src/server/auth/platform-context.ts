import '@tanstack/react-start/server-only'
import { setContextField } from '~/server/logging/log-context'
import { getPlatformAuth } from './platform-auth'

export interface PlatformContext {
  platformUserId: string
  email: string
  name: string
  sessionId: string
  sessionExpiresAt: string
}

/**
 * Resolves the active platform operator session from the `/platform`-scoped Better Auth cookie.
 * Completely isolated from tenant `session` / `app_user` tables.
 */
export async function getPlatformContext(request: Request): Promise<PlatformContext | null> {
  const auth = getPlatformAuth()
  const sessionRes = await auth.api.getSession({
    headers: request.headers,
  })

  if (!sessionRes?.session || !sessionRes?.user) {
    return null
  }

  setContextField('userId', sessionRes.user.id)

  const expiresAtRaw = sessionRes.session.expiresAt
  const sessionExpiresAt =
    expiresAtRaw instanceof Date ? expiresAtRaw.toISOString() : String(expiresAtRaw)

  return {
    platformUserId: sessionRes.user.id,
    email: sessionRes.user.email,
    name: sessionRes.user.name,
    sessionId: sessionRes.session.id,
    sessionExpiresAt,
  }
}
