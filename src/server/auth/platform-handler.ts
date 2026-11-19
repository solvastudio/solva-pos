import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  cancelOwnerInvite,
  createTenant,
  getPlatformTenantView,
  issueResetCodeAsOperator,
  listOwnerInvites,
  listTenants,
  reissueOwnerInvite,
  renameTenant,
  setTenantStatus,
} from '~/modules/identity/public'
import { createLogger } from '~/server/log'
import { getContext } from '~/server/logging/log-context'
import { newRefId } from '~/server/logging/log-time'
import { toPublicError } from '~/server/public-error'
import { checkSameOrigin } from './origin-check'
import { getPlatformAuth } from './platform-auth'
import { getPlatformContext, type PlatformContext } from './platform-context'
import { getClientIp } from './rate-limit/client-ip'
import { checkLogin, recordLoginFailure, recordLoginSuccess } from './rate-limit/login-limiter'
import { rateLimitedResponse } from './rate-limit/rate-limited-response'

const log = createLogger('platform.auth')

const MIN_LOGIN_MS = 250
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const createTenantSchema = z.object({
  name: z.string(),
  slug: z.string(),
  ownerEmail: z.string(),
  ownerDisplayName: z.string(),
})

const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
})

const renameSchema = z.object({
  name: z.string(),
})

const resetCodeSchema = z.object({
  appUserId: z.string().uuid(),
})

export interface PlatformHandlerDeps {
  minLoginDelayMs?: number
  remoteAddress?: string
  nowMs?: () => number
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 8)
}

async function ensureMinDuration(startedAt: number, minMs: number): Promise<void> {
  for (;;) {
    const remaining = minMs - (performance.now() - startedAt)
    if (remaining <= 0) return
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(remaining)))
  }
}

function copySetCookieHeaders(from: Headers, to: Headers): void {
  const getter = (from as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getter === 'function') {
    for (const c of getter.call(from)) to.append('Set-Cookie', c)
    return
  }
  const single = from.get('set-cookie')
  if (single) to.append('Set-Cookie', single)
}

function errorJson(err: unknown): Response {
  const reqId = getContext()?.reqId ?? newRefId()
  const pub = toPublicError(err, reqId)
  return Response.json(
    {
      error: {
        code: pub.code,
        ref: reqId,
        message: pub.message,
      },
    },
    { status: pub.status },
  )
}

async function handlePlatformLogin(
  request: Request,
  deps?: PlatformHandlerDeps,
): Promise<Response> {
  const startedAt = performance.now()
  const minDelayMs = deps?.minLoginDelayMs ?? MIN_LOGIN_MS

  let rawEmail = ''
  let password = ''
  try {
    const body = (await request.json()) as Record<string, unknown>
    if (typeof body?.email === 'string') rawEmail = body.email
    if (typeof body?.password === 'string') password = body.password
  } catch {
    await ensureMinDuration(startedAt, minDelayMs)
    return Response.json(
      { error: { code: 'UNAUTHORIZED', messageKey: 'auth.login.invalid' } },
      { status: 401 },
    )
  }

  const normalizedEmail = rawEmail.trim().toLowerCase()
  const emailHash = hashEmail(normalizedEmail)
  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail) || !password) {
    await ensureMinDuration(startedAt, minDelayMs)
    return Response.json(
      { error: { code: 'UNAUTHORIZED', messageKey: 'auth.login.invalid' } },
      { status: 401 },
    )
  }

  const ip = getClientIp(request, deps?.remoteAddress)
  const nowMs = deps?.nowMs?.()
  // Isolated counter key `'platform:' + email` so tenant and platform failure counters stay separate.
  const limitKey = `platform:${normalizedEmail}`

  const limitCheck = await checkLogin({
    email: limitKey,
    slug: 'platform',
    ip,
    nowMs,
  })
  if (!limitCheck.allowed) {
    await ensureMinDuration(startedAt, minDelayMs)
    return rateLimitedResponse(limitCheck.retryAfterMs, 'interactive')
  }

  try {
    const auth = getPlatformAuth()
    const signInRes = await auth.api.signInEmail({
      body: {
        email: normalizedEmail,
        password,
        rememberMe: true,
      },
      headers: request.headers,
      asResponse: true,
    })

    if (!signInRes.ok) {
      await recordLoginFailure({
        email: limitKey,
        slug: 'platform',
        ip,
        nowMs,
      })
      await ensureMinDuration(startedAt, minDelayMs)
      log.warn({ usernameHash: emailHash, outcome: 'REJECTED', status: 401 }, 'platform login rejected')
      return Response.json(
        { error: { code: 'UNAUTHORIZED', messageKey: 'auth.login.invalid' } },
        { status: 401 },
      )
    }

    recordLoginSuccess(limitKey)
    const headers = new Headers()
    copySetCookieHeaders(signInRes.headers, headers)
    log.info({ usernameHash: emailHash, outcome: 'ACK', status: 200 }, 'platform login succeeded')
    return Response.json({ ok: true }, { status: 200, headers })
  } catch (err: unknown) {
    await recordLoginFailure({
      email: limitKey,
      slug: 'platform',
      ip,
      nowMs,
    })
    await ensureMinDuration(startedAt, minDelayMs)
    log.warn({ err, usernameHash: emailHash, outcome: 'REJECTED' }, 'platform login failed')
    return Response.json(
      { error: { code: 'UNAUTHORIZED', messageKey: 'auth.login.invalid' } },
      { status: 401 },
    )
  }
}

async function handlePlatformLogout(request: Request): Promise<Response> {
  const auth = getPlatformAuth()
  const headers = new Headers()
  try {
    const res = await auth.api.signOut({
      headers: request.headers,
      asResponse: true,
    })
    copySetCookieHeaders(res.headers, headers)
  } catch {
    // Missing or already expired session returns cleanly.
  }
  return Response.json({ ok: true }, { status: 200, headers })
}

async function requireOperator(
  request: Request,
): Promise<{ ok: true; op: PlatformContext } | { ok: false; res: Response }> {
  const op = await getPlatformContext(request)
  if (!op) {
    return {
      ok: false,
      res: Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
    }
  }
  return { ok: true, op }
}

/**
 * Allowlisted HTTP dispatcher for `/platform/api/*`.
 */
export async function handlePlatformApi(
  request: Request,
  deps?: PlatformHandlerDeps,
): Promise<Response> {
  const url = new URL(request.url)
  const prefix = '/platform/api'
  if (!url.pathname.startsWith(prefix)) {
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  }

  const subpath = url.pathname.slice(prefix.length).replace(/\/+$/, '') || '/'
  const method = request.method.toUpperCase()

  if (method === 'POST') {
    const originCheck = checkSameOrigin(request)
    if (!originCheck.ok) {
      return Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 })
    }
  }

  if (method === 'POST' && subpath === '/auth/login') {
    return handlePlatformLogin(request, deps)
  }
  if (method === 'POST' && subpath === '/auth/logout') {
    return handlePlatformLogout(request)
  }
  if (subpath === '/auth' || subpath.startsWith('/auth/')) {
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  }
  if (method === 'GET' && subpath === '/session') {
    const op = await getPlatformContext(request)
    return Response.json({ session: op }, { status: 200 })
  }

  const authCheck = await requireOperator(request)
  if (!authCheck.ok) {
    return authCheck.res
  }
  const op = authCheck.op

  try {
    if (method === 'GET' && subpath === '/tenants') {
      const tenants = await listTenants(op)
      return Response.json({ tenants }, { status: 200 })
    }

    if (method === 'POST' && subpath === '/tenants') {
      const raw = await request.json()
      const parsed = createTenantSchema.parse(raw)
      const created = await createTenant(op, parsed)
      return Response.json(created, { status: 201 })
    }

    const detailMatch = /^\/tenants\/([^/]+)$/.exec(subpath)
    if (method === 'GET' && detailMatch) {
      const view = await getPlatformTenantView(op, detailMatch[1]!)
      if (!view) {
        return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
      }
      return Response.json(view, { status: 200 })
    }

    const statusMatch = /^\/tenants\/([^/]+)\/status$/.exec(subpath)
    if (method === 'POST' && statusMatch) {
      const body = statusSchema.parse(await request.json())
      const updated = await setTenantStatus(op, statusMatch[1]!, body.status)
      return Response.json({ tenant: updated }, { status: 200 })
    }

    const renameMatch = /^\/tenants\/([^/]+)\/rename$/.exec(subpath)
    if (method === 'POST' && renameMatch) {
      const body = renameSchema.parse(await request.json())
      const updated = await renameTenant(op, renameMatch[1]!, body.name)
      return Response.json({ tenant: updated }, { status: 200 })
    }

    const invitesMatch = /^\/tenants\/([^/]+)\/invites$/.exec(subpath)
    if (method === 'GET' && invitesMatch) {
      const invites = await listOwnerInvites(op, invitesMatch[1]!)
      return Response.json({ invites }, { status: 200 })
    }

    const inviteActionMatch = /^\/tenants\/([^/]+)\/invites\/([^/]+)\/(cancel|reissue)$/.exec(
      subpath,
    )
    if (method === 'POST' && inviteActionMatch) {
      const tenantId = inviteActionMatch[1]!
      const appUserId = inviteActionMatch[2]!
      const action = inviteActionMatch[3]!
      if (action === 'cancel') {
        await cancelOwnerInvite(op, tenantId, appUserId)
        return Response.json({ ok: true }, { status: 200 })
      }
      const reissued = await reissueOwnerInvite(op, tenantId, appUserId)
      return Response.json(reissued, { status: 200 })
    }

    const resetMatch = /^\/tenants\/([^/]+)\/reset-code$/.exec(subpath)
    if (method === 'POST' && resetMatch) {
      const body = resetCodeSchema.parse(await request.json())
      const issued = await issueResetCodeAsOperator(op, {
        tenantId: resetMatch[1]!,
        appUserId: body.appUserId,
      })
      return Response.json(issued, { status: 200 })
    }

    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  } catch (err: unknown) {
    return errorJson(err)
  }
}
