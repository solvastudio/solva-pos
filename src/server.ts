import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
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

export default createServerEntry({
  fetch(request, opts) {
    return handleRequestWithLog(request, (req) => handler.fetch(req, opts), {
      env: env.APP_ENV,
      appVersion: __APP_VERSION__,
    })
  },
})
