import '@tanstack/react-start/server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface LogContext {
  reqId: string
  tenantId?: string
  userId?: string
  deviceId?: string
  registerId?: string
  commandId?: string
  jobId?: string
  parentReqId?: string
  env: string
  appVersion?: string
  schemaVersion?: number
}

const storage = new AsyncLocalStorage<LogContext>()

export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export function getContext(): LogContext | undefined {
  return storage.getStore()
}

export function setContextField<K extends keyof LogContext>(key: K, value: LogContext[K]): void {
  const store = storage.getStore()
  if (store) {
    store[key] = value
  }
}
