import '@tanstack/react-start/server-only'
import { createLogger } from '../log'
import { getNotifier } from '../notify/notifier'
import { flushLogs } from './logger-core'

const log = createLogger('process')
const FATAL_NOTIFY_TIMEOUT_MS = 2_000

export interface ProcessHandlerOptions {
  flush?: () => void
  exitOnFatal?: boolean
  exit?: (code: number) => void
  target?: Pick<NodeJS.Process, 'on'>
  notifyFatalTimeoutMs?: number
}

declare global {
  var __solvaProcessHandlersInstalled: boolean | undefined
}

export function installProcessHandlers(options: ProcessHandlerOptions = {}): void {
  const target = options.target ?? process
  if (target === process) {
    if (globalThis.__solvaProcessHandlersInstalled) return
    globalThis.__solvaProcessHandlersInstalled = true
  }

  const flush = options.flush ?? flushLogs
  const exitOnFatal = options.exitOnFatal ?? process.env.APP_ENV === 'production'
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const notifyTimeoutMs = options.notifyFatalTimeoutMs ?? FATAL_NOTIFY_TIMEOUT_MS

  async function onFatal(
    kind: 'uncaughtException' | 'unhandledRejection',
    err: unknown,
  ): Promise<void> {
    log.fatal({ err, reason: kind }, exitOnFatal ? `${kind}; exiting process` : kind)
    flush()
    const notifier = getNotifier()
    if (!notifier.enabled) {
      notifier.notify(kind === 'uncaughtException' ? 'fatal' : 'fatal', { code: kind })
      if (exitOnFatal) {
        exit(1)
      }
      return
    }

    const notifyPromise = notifier.notifyImmediate('fatal', { code: kind }).catch(() => false)

    if (exitOnFatal) {
      await Promise.race([
        notifyPromise,
        new Promise<void>((resolve) => setTimeout(resolve, notifyTimeoutMs)),
      ])
      exit(1)
    } else {
      await notifyPromise
    }
  }

  target.on('uncaughtException', (err) => {
    void onFatal('uncaughtException', err)
  })
  target.on('unhandledRejection', (reason) => {
    void onFatal('unhandledRejection', reason)
  })
}
