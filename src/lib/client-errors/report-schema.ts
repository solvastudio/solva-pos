import { APP_VERSION } from '~/lib/app-version'
import {
  DeviceLogEntrySchema,
  type DeviceLogEntry,
  SCHEMA_VERSION,
} from '~/lib/contracts'
import { newLocalRef } from './local-ref'

export { DeviceLogEntrySchema, type DeviceLogEntry }

const SENSITIVE_CLIENT_KEY = /(pin|token|secret|password|passwd|credential|hash|customer|name|phone)/i
const MAX_CLIENT_BUFFER = 50
const pendingMemoryLog: DeviceLogEntry[] = []

export function scrubClientContext(ctx: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  if (!ctx) return {}
  const out: Record<string, string | number | boolean> = {}
  for (const [key, val] of Object.entries(ctx)) {
    if (SENSITIVE_CLIENT_KEY.test(key)) continue
    if (typeof val === 'string') {
      out[key] = val.slice(0, 200)
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      out[key] = val
    }
  }
  return out
}

/**
 * Records a client error entry into the bounded in-memory buffer (until offline Dexie
 * `device_log` store is wired in later phases) without leaking sensitive payload fields.
 */
export function logClientError(input: {
  refLocal?: string
  code: string
  level?: 'info' | 'warn' | 'error'
  route?: string | null
  stack?: string | null
  componentStack?: string | null
  ctx?: Record<string, unknown>
  clockOffsetMs?: number | null
  nowMs?: number
}): DeviceLogEntry {
  const nowMs = input.nowMs ?? Date.now()
  const entry = DeviceLogEntrySchema.parse({
    ref_local: input.refLocal ?? newLocalRef(nowMs + (input.clockOffsetMs ?? 0)),
    created_at: new Date(nowMs).toISOString(),
    clock_offset_ms: input.clockOffsetMs ?? null,
    level: input.level ?? 'error',
    code: input.code.slice(0, 40),
    route: input.route ? input.route.slice(0, 200) : null,
    stack: input.stack ? input.stack.slice(0, 4000) : null,
    component_stack: input.componentStack ? input.componentStack.slice(0, 4000) : null,
    ctx: scrubClientContext(input.ctx),
    app_version: APP_VERSION.slice(0, 30),
    schema_version: SCHEMA_VERSION,
  })

  if (pendingMemoryLog.length >= MAX_CLIENT_BUFFER) {
    pendingMemoryLog.shift()
  }
  pendingMemoryLog.push(entry)
  return entry
}

export function getClientErrorBufferForTests(): readonly DeviceLogEntry[] {
  return pendingMemoryLog
}

export function clearClientErrorBufferForTests(): void {
  pendingMemoryLog.length = 0
}
