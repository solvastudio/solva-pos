import '@tanstack/react-start/server-only'
import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino'
import { serializeError } from './error-serializer'
import { createDestination, type FileSink } from './file-destination'
import { getContext } from './log-context'
import type { LogFields } from './log-fields'

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export type LogMethod = (fields: LogFields, msg?: string) => void
export type Logger = Record<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', LogMethod>

let rootLogger: PinoLogger | null = null
let activeFileSink: FileSink | null = null
let capturedLines: string[] | null = null
let stdoutErrorGuarded = false
const scopedChildren = new Map<string, PinoLogger>()

function resolveConfiguredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL
  const isKnown = (LOG_LEVELS as readonly string[]).includes(raw ?? '')
  if (process.env.VITEST && !isKnown) {
    return 'silent'
  }
  return isKnown ? (raw as LogLevel) : 'info'
}

function buildContextMixin(): Record<string, unknown> {
  const ctx = getContext()
  if (!ctx) return {}
  const out: Record<string, unknown> = { reqId: ctx.reqId, env: ctx.env }
  if (ctx.tenantId) out.tenantId = ctx.tenantId
  if (ctx.userId) out.userId = ctx.userId
  if (ctx.deviceId) out.deviceId = ctx.deviceId
  if (ctx.registerId) out.registerId = ctx.registerId
  if (ctx.commandId) out.commandId = ctx.commandId
  if (ctx.jobId) out.jobId = ctx.jobId
  if (ctx.parentReqId) out.parentReqId = ctx.parentReqId
  if (ctx.appVersion) out.appVersion = ctx.appVersion
  if (ctx.schemaVersion !== undefined) out.schemaVersion = ctx.schemaVersion
  return out
}

export function createRootLogger(options?: {
  level?: LogLevel
  destination?: DestinationStream
}): PinoLogger {
  if (!stdoutErrorGuarded) {
    process.stdout.on('error', () => {})
    stdoutErrorGuarded = true
  }

  const customDestination = options?.destination
  if (!customDestination) {
    const dest = createDestination({
      APP_ENV: process.env.VITEST ? 'test' : (process.env.APP_ENV ?? 'development'),
      LOG_DIR: process.env.LOG_DIR || './logs',
    })
    activeFileSink = dest.fileSink
  }

  const interceptingStream: DestinationStream = {
    write(chunk: string): void {
      if (capturedLines) {
        capturedLines.push(chunk)
        return
      }
      if (customDestination) {
        customDestination.write(chunk)
        return
      }
      process.stdout.write(chunk)
      activeFileSink?.write(chunk)
    },
  }

  return pino(
    {
      level: options?.level ?? resolveConfiguredLevel(),
      base: null,
      messageKey: 'msg',
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      formatters: {
        level: (label) => ({ level: label }),
      },
      serializers: {
        err: serializeError,
      },
      mixin: buildContextMixin,
    },
    interceptingStream,
  )
}

export function getRootLogger(): PinoLogger {
  if (!rootLogger) {
    rootLogger = createRootLogger()
  }
  return rootLogger
}

function childForScope(scope: string): PinoLogger {
  let child = scopedChildren.get(scope)
  if (!child) {
    child = getRootLogger().child({ scope })
    scopedChildren.set(scope, child)
  }
  return child
}

export function createScopedLogger(scope: string): Logger {
  const wrap =
    (level: keyof Logger): LogMethod =>
    (fields, msg = '') => {
      childForScope(scope)[level](fields, msg)
    }

  return {
    trace: wrap('trace'),
    debug: wrap('debug'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
    fatal: wrap('fatal'),
  }
}

export function flushLogs(): void {
  activeFileSink?.flush()
}

export function captureLogs(level: LogLevel = 'debug'): {
  lines: () => string[]
  entries: () => Record<string, unknown>[]
  stop: () => void
} {
  const root = getRootLogger()
  const prevLevel = root.level
  const lines: string[] = []
  capturedLines = lines
  root.level = level
  scopedChildren.clear()

  return {
    lines: () => [...lines],
    entries: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
    stop: () => {
      capturedLines = null
      root.level = prevLevel
      scopedChildren.clear()
    },
  }
}

export function resetLoggerForTests(): void {
  rootLogger = null
  activeFileSink = null
  capturedLines = null
  scopedChildren.clear()
}
