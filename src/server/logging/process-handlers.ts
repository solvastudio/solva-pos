import '@tanstack/react-start/server-only'
import { createLogger } from '../log'
import { flushLogs } from './logger-core'

const log = createLogger('process')

export interface ProcessHandlerOptions {
  flush?: () => void
  exitOnFatal?: boolean
  exit?: (code: number) => void
  target?: Pick<NodeJS.Process, 'on'>
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

  function onFatal(kind: 'uncaughtException' | 'unhandledRejection', err: unknown): void {
    log.fatal({ err, reason: kind }, exitOnFatal ? `${kind}; exiting process` : kind)
    flush()
    if (exitOnFatal) {
      exit(1)
    }
  }

  target.on('uncaughtException', (err) => onFatal('uncaughtException', err))
  target.on('unhandledRejection', (reason) => onFatal('unhandledRejection', reason))
}
