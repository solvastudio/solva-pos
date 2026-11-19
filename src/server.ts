import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { canonicalizePath } from '~/lib/tenancy/canonical-path'
import { getEnv, type AppEnv } from '~/server/env'
import { createLogger } from '~/server/log'
import { startLogRetention } from '~/server/logging/log-retention'
import { getRootLogger } from '~/server/logging/logger-core'
import { installProcessHandlers } from '~/server/logging/process-handlers'
import { handleRequestWithLog } from '~/server/logging/request-log'

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

export default createServerEntry({
  fetch(request, opts) {
    return handleRequestWithLog(
      request,
      (req) => maybeCanonicalRedirect(req) ?? handler.fetch(req, opts),
      {
        env: env.APP_ENV,
        appVersion: __APP_VERSION__,
      },
    )
  },
})
