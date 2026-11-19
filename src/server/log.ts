import '@tanstack/react-start/server-only'
import { createScopedLogger, type Logger } from './logging/logger-core'

export type { LogFields } from './logging/log-fields'
export type { Logger, LogMethod } from './logging/logger-core'

export function createLogger(scope: string): Logger {
  return createScopedLogger(scope)
}
