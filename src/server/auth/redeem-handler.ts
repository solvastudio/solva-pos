import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { normalizeSlug } from '~/lib/kernel'
import {
  getTenantAuthMetadataBySlug,
  redeemInvite,
  redeemReset,
  type RedeemDeps,
} from '~/modules/identity/public'
import { createLogger } from '~/server/log'
import { setContextField } from '~/server/logging/log-context'
import { createTenantAuth } from './auth-factory'
import { checkSameOrigin } from './origin-check'
import { getClientIp } from './rate-limit/client-ip'
import { getLimiters } from './rate-limit/limiters'
import { recordLoginSuccess } from './rate-limit/login-limiter'
import { rateLimitedResponse } from './rate-limit/rate-limited-response'

const log = createLogger('auth.redeem')

const MIN_REDEEM_RESPONSE_MS = 250

export interface RedeemHandlerDeps extends RedeemDeps {
  minResponseMs?: number
  remoteAddress?: string
  nowMs?: () => number
}

function hashEmailForLog(email: string): string {
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
  const getSetCookie = (from as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') {
    for (const cookie of getSetCookie.call(from)) {
      to.append('Set-Cookie', cookie)
    }
    return
  }
  const single = from.get('set-cookie')
  if (single) to.append('Set-Cookie', single)
}

async function rejectUniformRedeem(startedAt: number, minMs: number): Promise<Response> {
  await ensureMinDuration(startedAt, minMs)
  return Response.json(
    {
      error: { code: 'VALIDATION_FAILED' },
      message: 'sys.code.invalid',
    },
    { status: 400 },
  )
}

async function handleRedeemKind(
  kind: 'INVITE' | 'RESET',
  request: Request,
  rawSlug: string,
  deps?: RedeemHandlerDeps,
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') {
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  }

  const originCheck = checkSameOrigin(request)
  if (!originCheck.ok) {
    return Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 })
  }

  const slug = normalizeSlug(rawSlug)
  const tenant = await getTenantAuthMetadataBySlug(slug)
  if (!tenant) {
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  }
  if (tenant.status !== 'ACTIVE') {
    return Response.json({ error: { code: 'TENANT_SUSPENDED' } }, { status: 403 })
  }

  setContextField('tenantId', tenant.tenantId)
  const startedAt = performance.now()
  const minMs = deps?.minResponseMs ?? MIN_REDEEM_RESPONSE_MS
  const nowMs = deps?.nowMs?.() ?? Date.now()
  const ip = getClientIp(request, deps?.remoteAddress)

  let email = ''
  let code = ''
  let password = ''
  try {
    const body = (await request.json()) as Record<string, unknown>
    if (typeof body?.email === 'string') email = body.email
    if (typeof body?.code === 'string') code = body.code
    if (typeof body?.password === 'string') password = body.password
  } catch {
    return rejectUniformRedeem(startedAt, minMs)
  }

  const normalizedEmail = email.trim().toLowerCase()
  const limiters = getLimiters()

  if (ip) {
    const ipSlugDecision = await limiters.redeemIpSlug.consume(`${ip}:${tenant.slug}`, nowMs)
    if (!ipSlugDecision.allowed) {
      return rateLimitedResponse(ipSlugDecision.retryAfterMs, 'interactive')
    }
  }

  const slugDecision = await limiters.redeemSlug.consume(tenant.slug, nowMs)
  if (!slugDecision.allowed) {
    return rateLimitedResponse(slugDecision.retryAfterMs, 'interactive')
  }

  const emailPeek = await limiters.redeemEmail.peek(`${tenant.slug}:${normalizedEmail}`, nowMs)
  if (!emailPeek.allowed) {
    return rateLimitedResponse(emailPeek.retryAfterMs, 'interactive')
  }

  const serviceFn = kind === 'INVITE' ? redeemInvite : redeemReset
  const result = await serviceFn(
    {
      tenantId: tenant.tenantId,
      tenantSlug: tenant.slug,
      authOrgId: tenant.authOrgId,
      email: normalizedEmail,
      code,
      password,
    },
    deps,
  )

  const emailHash = hashEmailForLog(normalizedEmail)
  if (!result.ok) {
    await limiters.redeemEmail.consume(`${tenant.slug}:${normalizedEmail}`, nowMs)
    log.warn(
      {
        usernameHash: emailHash,
        usernameLength: normalizedEmail.length,
        outcome: 'REJECTED',
        status: 400,
      },
      'code redemption rejected',
    )
    return rejectUniformRedeem(startedAt, minMs)
  }

  log.info(
    {
      usernameHash: emailHash,
      usernameLength: normalizedEmail.length,
      outcome: 'ACK',
      status: 200,
    },
    'code redemption succeeded',
  )

  if (kind === 'RESET') {
    recordLoginSuccess(normalizedEmail)
    return Response.json(
      {
        ok: true,
        next: `/${tenant.slug}/admin/login`,
      },
      { status: 200 },
    )
  }

  try {
    const auth = createTenantAuth(tenant.slug, tenant.tenantId, tenant.authOrgId)
    const signInRes = await auth.api.signInEmail({
      body: {
        email: normalizedEmail,
        password,
        rememberMe: true,
      },
      headers: request.headers,
      asResponse: true,
    })

    if (signInRes.ok) {
      const headers = new Headers()
      copySetCookieHeaders(signInRes.headers, headers)
      return Response.json(
        {
          ok: true,
          next: `/${tenant.slug}/admin`,
        },
        { status: 200, headers },
      )
    }
  } catch {
    // Fall through cleanly to manual login redirect when auto sign-in fails.
  }

  return Response.json(
    {
      ok: true,
      next: `/${tenant.slug}/admin/login`,
    },
    { status: 200 },
  )
}

export function handleJoin(
  request: Request,
  slug: string,
  deps?: RedeemHandlerDeps,
): Promise<Response> {
  return handleRedeemKind('INVITE', request, slug, deps)
}

export function handleReset(
  request: Request,
  slug: string,
  deps?: RedeemHandlerDeps,
): Promise<Response> {
  return handleRedeemKind('RESET', request, slug, deps)
}
