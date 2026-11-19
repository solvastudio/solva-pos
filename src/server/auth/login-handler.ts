import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { normalizeSlug } from '~/lib/kernel'
import {
  checkActiveMembership,
  getTenantAuthMetadataBySlug,
  type TenantAuthMetadata,
} from '~/modules/identity/public'
import { createLogger } from '~/server/log'
import { setContextField } from '~/server/logging/log-context'
import { getAuthContext } from './auth-context'
import { createTenantAuth } from './auth-factory'
import { checkSameOrigin } from './origin-check'

const log = createLogger('auth')

const MIN_LOGIN_RESPONSE_MS = 250
const EMAIL_BASIC_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface LoginAttemptHookContext {
  slug: string
  usernameHash: string
  ip?: string
}

export type LoginAttemptHook = (ctx: LoginAttemptHookContext) => Promise<void> | void

export interface AuthHandlerDeps {
  onLoginAttempt?: LoginAttemptHook
  minLoginDelayMs?: number
}

/**
 * Default no-op login attempt hook.
 * Fase 17 plugs progressive delay and IP rate limiting into this hook.
 */
const noopLoginAttempt: LoginAttemptHook = () => {}

export function hashLoginIdentifier(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 8)
}

function getClientIp(request: Request): string | undefined {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
}

async function ensureMinDuration(startedAt: number, minDelayMs: number): Promise<void> {
  for (;;) {
    const remaining = minDelayMs - (performance.now() - startedAt)
    if (remaining <= 0) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(remaining)))
  }
}

function copySetCookieHeaders(from: Headers, to: Headers): void {
  const getSetCookie = (from as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') {
    for (const cookie of getSetCookie.call(from)) {
      to.append('Set-Cookie', cookie)
    }
    return
  }
  const single = from.get('set-cookie')
  if (single) {
    to.append('Set-Cookie', single)
  }
}

async function rejectUniformLogin(
  startedAt: number,
  minDelayMs: number,
  meta: { usernameHash: string; usernameLength: number; reason: string },
): Promise<Response> {
  await ensureMinDuration(startedAt, minDelayMs)
  const durationMs = Math.round(performance.now() - startedAt)
  log.warn(
    {
      usernameHash: meta.usernameHash,
      usernameLength: meta.usernameLength,
      reason: meta.reason,
      outcome: 'REJECTED',
      status: 401,
      durationMs,
    },
    'login rejected',
  )
  return Response.json(
    {
      error: {
        code: 'UNAUTHORIZED',
        messageKey: 'auth.login.invalid',
      },
    },
    { status: 401 },
  )
}

async function handleLogin(
  request: Request,
  tenant: TenantAuthMetadata,
  deps?: AuthHandlerDeps,
): Promise<Response> {
  const startedAt = performance.now()
  const minDelayMs = deps?.minLoginDelayMs ?? MIN_LOGIN_RESPONSE_MS
  setContextField('tenantId', tenant.tenantId)

  let rawEmail = ''
  let password = ''
  let rememberMe = true

  try {
    const body = (await request.json()) as Record<string, unknown>
    if (typeof body?.email === 'string') rawEmail = body.email
    if (typeof body?.password === 'string') password = body.password
    if (typeof body?.rememberMe === 'boolean') rememberMe = body.rememberMe
  } catch {
    return rejectUniformLogin(startedAt, minDelayMs, {
      usernameHash: hashLoginIdentifier(''),
      usernameLength: 0,
      reason: 'malformed_body',
    })
  }

  const normalizedEmail = rawEmail.trim().toLowerCase()
  const usernameHash = hashLoginIdentifier(normalizedEmail)
  const usernameLength = normalizedEmail.length

  if (!normalizedEmail || !EMAIL_BASIC_PATTERN.test(normalizedEmail) || !password) {
    return rejectUniformLogin(startedAt, minDelayMs, {
      usernameHash,
      usernameLength,
      reason: 'invalid_input_shape',
    })
  }

  try {
    await (deps?.onLoginAttempt ?? noopLoginAttempt)({
      slug: tenant.slug,
      usernameHash,
      ip: getClientIp(request),
    })

    const auth = createTenantAuth(tenant.slug, tenant.tenantId, tenant.authOrgId)
    const signInRes = await auth.api.signInEmail({
      body: {
        email: normalizedEmail,
        password,
        rememberMe,
      },
      headers: request.headers,
      asResponse: true,
    })

    if (!signInRes.ok) {
      return rejectUniformLogin(startedAt, minDelayMs, {
        usernameHash,
        usernameLength,
        reason: 'credentials_or_membership_rejected',
      })
    }

    const payload = (await signInRes.json().catch(() => null)) as {
      user?: { id?: string; email?: string; name?: string }
    } | null
    const authUserId = payload?.user?.id
    if (!authUserId) {
      return rejectUniformLogin(startedAt, minDelayMs, {
        usernameHash,
        usernameLength,
        reason: 'missing_user_payload',
      })
    }

    const isMember = await checkActiveMembership(tenant.tenantId, tenant.authOrgId, authUserId)
    if (!isMember) {
      return rejectUniformLogin(startedAt, minDelayMs, {
        usernameHash,
        usernameLength,
        reason: 'membership_inactive',
      })
    }

    const headers = new Headers()
    copySetCookieHeaders(signInRes.headers, headers)

    const durationMs = Math.round(performance.now() - startedAt)
    log.info(
      {
        usernameHash,
        usernameLength,
        outcome: 'ACK',
        status: 200,
        durationMs,
      },
      'login succeeded',
    )

    return Response.json(
      {
        ok: true,
        user: {
          id: authUserId,
          email: payload?.user?.email ?? normalizedEmail,
          name: payload?.user?.name ?? normalizedEmail,
        },
      },
      { status: 200, headers },
    )
  } catch (err: unknown) {
    log.warn(
      {
        err,
        usernameHash,
        usernameLength,
        reason: 'auth_exception',
      },
      'login failed with exception',
    )
    return rejectUniformLogin(startedAt, minDelayMs, {
      usernameHash,
      usernameLength,
      reason: 'auth_exception',
    })
  }
}

async function handleLogout(request: Request, tenant: TenantAuthMetadata): Promise<Response> {
  setContextField('tenantId', tenant.tenantId)
  const auth = createTenantAuth(tenant.slug, tenant.tenantId, tenant.authOrgId)
  const headers = new Headers()

  try {
    const signOutRes = await auth.api.signOut({
      headers: request.headers,
      asResponse: true,
    })
    copySetCookieHeaders(signOutRes.headers, headers)
  } catch {
    // Clearing missing or already expired sessions still returns ok with clean state.
  }

  log.info({ outcome: 'ACK', status: 200 }, 'logout completed')
  return Response.json({ ok: true }, { status: 200, headers })
}

async function handleGetSession(request: Request, tenant: TenantAuthMetadata): Promise<Response> {
  const ctx = await getAuthContext(request, tenant.slug)
  if (!ctx) {
    return Response.json({ session: null }, { status: 200 })
  }

  return Response.json(
    {
      session: {
        tenantId: ctx.tenantId,
        tenantSlug: ctx.tenantSlug,
        appUserId: ctx.appUserId,
        email: ctx.email,
        displayName: ctx.displayName,
        locale: ctx.locale,
        roleCodes: ctx.roleCodes,
        permissions: [...ctx.permissions],
        outletIds: ctx.outletIds,
        discountLimitPct: ctx.discountLimitPct,
        sessionExpiresAt: ctx.sessionExpiresAt,
      },
    },
    { status: 200 },
  )
}

async function handleChangePassword(
  request: Request,
  tenant: TenantAuthMetadata,
): Promise<Response> {
  const ctx = await getAuthContext(request, tenant.slug)
  if (!ctx) {
    return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  let currentPassword = ''
  let newPassword = ''
  try {
    const body = (await request.json()) as Record<string, unknown>
    if (typeof body?.currentPassword === 'string') currentPassword = body.currentPassword
    if (typeof body?.newPassword === 'string') newPassword = body.newPassword
  } catch {
    return Response.json({ error: { code: 'VALIDATION_FAILED' } }, { status: 400 })
  }

  if (!currentPassword || newPassword.length < 8 || newPassword.length > 128) {
    return Response.json({ error: { code: 'VALIDATION_FAILED' } }, { status: 400 })
  }

  const auth = createTenantAuth(tenant.slug, tenant.tenantId, tenant.authOrgId)
  try {
    // Better Auth `changePassword` with `revokeOtherSessions: true` deletes all sessions
    // for `userId` across every tenant organization in DB and issues a rotated session
    // cookie for the current caller's request.
    const changeRes = await auth.api.changePassword({
      body: {
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      },
      headers: request.headers,
      asResponse: true,
    })

    if (!changeRes.ok) {
      log.warn({ outcome: 'REJECTED', reason: 'wrong_current_password' }, 'password change failed')
      return Response.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            messageKey: 'account.password.wrongCurrent',
          },
        },
        { status: 400 },
      )
    }

    const headers = new Headers()
    copySetCookieHeaders(changeRes.headers, headers)
    log.info({ outcome: 'ACK' }, 'password changed and prior sessions revoked')
    return Response.json({ ok: true }, { status: 200, headers })
  } catch (err: unknown) {
    log.warn({ err, outcome: 'REJECTED', reason: 'change_password_error' }, 'password change failed')
    return Response.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          messageKey: 'account.password.wrongCurrent',
        },
      },
      { status: 400 },
    )
  }
}

/**
 * Explicit allowlist dispatcher for `/$tenant/admin/api/auth/$`.
 * Better Auth endpoints outside these four actions always return 404.
 */
export async function handleAuthRoute(
  request: Request,
  rawSlug: string,
  deps?: AuthHandlerDeps,
): Promise<Response> {
  const slug = normalizeSlug(rawSlug)
  const pathname = new URL(request.url).pathname
  const prefix = `/${slug}/admin/api/auth`
  const lowerPathname = pathname.toLowerCase()

  if (!lowerPathname.startsWith(prefix)) {
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  }

  const subpath = lowerPathname.slice(prefix.length).replace(/\/+$/, '') || '/'
  const method = request.method.toUpperCase()

  const isAllowedRoute =
    (method === 'POST' && subpath === '/sign-in/email') ||
    (method === 'POST' && subpath === '/sign-out') ||
    (method === 'POST' && subpath === '/change-password') ||
    (method === 'GET' && subpath === '/get-session')

  if (!isAllowedRoute) {
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  }

  if (method === 'POST') {
    const originCheck = checkSameOrigin(request)
    if (!originCheck.ok) {
      log.warn(
        {
          reason: originCheck.reason,
          origin: originCheck.origin ?? undefined,
          route: subpath,
          status: 403,
        },
        'cross-origin auth POST rejected',
      )
      return Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 })
    }
  }

  const tenant = await getTenantAuthMetadataBySlug(slug)
  if (!tenant) {
    if (method === 'GET' && subpath === '/get-session') {
      return Response.json({ session: null }, { status: 200 })
    }
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  }

  if (tenant.status !== 'ACTIVE') {
    if (method === 'GET' && subpath === '/get-session') {
      return Response.json({ session: null }, { status: 200 })
    }
    return Response.json({ error: { code: 'TENANT_SUSPENDED' } }, { status: 403 })
  }

  if (method === 'POST' && subpath === '/sign-in/email') {
    return handleLogin(request, tenant, deps)
  }
  if (method === 'POST' && subpath === '/sign-out') {
    return handleLogout(request, tenant)
  }
  if (method === 'POST' && subpath === '/change-password') {
    return handleChangePassword(request, tenant)
  }
  if (method === 'GET' && subpath === '/get-session') {
    return handleGetSession(request, tenant)
  }

  return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
}
