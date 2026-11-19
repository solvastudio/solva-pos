import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { normalizeSlug, RESERVED_SLUGS, SLUG_PATTERN } from '~/lib/kernel'
import { canonicalizePath } from '~/lib/tenancy/canonical-path'
import { getEnv, type AppEnv } from '~/server/env'
import { createLogger } from '~/server/log'
import { startLogRetention } from '~/server/logging/log-retention'
import { getRootLogger } from '~/server/logging/logger-core'
import { installProcessHandlers } from '~/server/logging/process-handlers'
import { handleRequestWithLog } from '~/server/logging/request-log'
import { startBackgroundJobs } from '~/server/jobs/scheduler'

function bootServerEnv(): AppEnv {
  try {
    return getEnv()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid environment configuration'
    process.stderr.write(`${msg}\n`)
    process.exit(1)
  }
}

const env = bootServerEnv()
getRootLogger()
startLogRetention(env.LOG_DIR, env.LOG_RETENTION_DAYS)
startBackgroundJobs()
installProcessHandlers({ exitOnFatal: env.APP_ENV === 'production' })
createLogger('boot').info({ appVersion: __APP_VERSION__ }, 'server started')

const SKIP_CANONICAL_PREFIXES = [
  '/_serverfn',
  '/_build',
  '/assets',
  '/api',
  '/@',
  '/src',
  '/node_modules',
  '/health',
  '/_dev',
]

function maybeCanonicalRedirect(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return null
  }
  const url = new URL(request.url)
  const lower = url.pathname.toLowerCase()
  if (SKIP_CANONICAL_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return null
  }
  const canonical = canonicalizePath(url.pathname)
  if (!canonical.changed) {
    return null
  }
  const location = `${canonical.pathname}${url.search}`
  return new Response(null, {
    status: 308,
    headers: { Location: location },
  })
}

const RESERVED_SET = new Set<string>(RESERVED_SLUGS)
const TENANT_SERVER_FN_RE = /^\/([^/]+)(\/_serverfn(?:\/.*)?)$/i

function sanitizeAndRewriteServerFn(request: Request): Request {
  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  // Always strip client-supplied X-Tenant-Slug so only our URL rewrite sets it.
  headers.delete('x-tenant-slug')

  const match = TENANT_SERVER_FN_RE.exec(url.pathname)
  if (match) {
    const slug = normalizeSlug(match[1]!)
    if (SLUG_PATTERN.test(slug) && !RESERVED_SET.has(slug)) {
      url.pathname = match[2]!
      headers.set('x-tenant-slug', slug)
      const method = request.method.toUpperCase()
      const init: RequestInit & { duplex?: 'half' } = {
        method,
        headers,
      }
      if (method !== 'GET' && method !== 'HEAD' && request.body) {
        init.body = request.body
        init.duplex = 'half'
      }
      return new Request(url.toString(), init)
    }
  }

  if (!request.headers.has('x-tenant-slug')) {
    return request
  }

  const method = request.method.toUpperCase()
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
  }
  if (method !== 'GET' && method !== 'HEAD' && request.body) {
    init.body = request.body
    init.duplex = 'half'
  }
  return new Request(request.url, init)
}

export default createServerEntry({
  fetch(request, opts) {
    const normalizedReq = sanitizeAndRewriteServerFn(request)
    return handleRequestWithLog(
      normalizedReq,
      (req) => maybeCanonicalRedirect(req) ?? handler.fetch(req, opts),
      {
        env: env.APP_ENV,
        appVersion: __APP_VERSION__,
      },
    )
  },
})
