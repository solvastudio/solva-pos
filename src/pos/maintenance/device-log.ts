import { APP_VERSION } from '~/lib/app-version'
import { newLocalRef } from '~/lib/client-errors/local-ref'
import { scrubClientContext } from '~/lib/client-errors/report-schema'
import { DEVICE_LOG_CODES, SCHEMA_VERSION } from '~/lib/contracts'
import { appendDeviceLogRow } from '../data/device-log.repo'
import type { SolvaDb } from '../db/solva-db'

const ALLOWED_LOG_CODES = new Set<string>(DEVICE_LOG_CODES)

export interface LogDeviceInput {
  level: 'info' | 'warn' | 'error'
  code: string
  route?: string | null
  stack?: string | null
  componentStack?: string | null
  ctx?: Record<string, unknown>
  clockOffsetMs?: number | null
}

export interface LogDeviceDeps {
  nowIso?: () => string
  correctedNowMs?: () => number
  rand?: () => number
}

function stripRouteQueryAndFragment(route: string | null | undefined): string | null {
  if (!route) return null
  const noFrag = route.split('#')[0] ?? route
  const noQuery = noFrag.split('?')[0] ?? noFrag
  return noQuery.slice(0, 200)
}

function sanitizeStack(stack: string | null | undefined): string | null {
  if (!stack) return null
  return stack.replace(/\?[^\s):]+/g, '').slice(0, 2000)
}

/**
 * Records a device diagnostic log entry in IndexedDB `device_log` (capped at 500 entries)
 * after validating the code against the closed catalog and scrubbing sensitive keys.
 */
export async function logDevice(
  db: SolvaDb,
  input: LogDeviceInput,
  deps?: LogDeviceDeps,
): Promise<string> {
  if (!ALLOWED_LOG_CODES.has(input.code)) {
    throw new Error(`Invalid device log code: ${input.code}`)
  }

  const correctedMs = (deps?.correctedNowMs ?? (() => Date.now()))()
  const nowIso = (deps?.nowIso ?? (() => new Date(correctedMs).toISOString()))()
  const refLocal = newLocalRef(correctedMs, deps?.rand)
  const cleanCtx = scrubClientContext(input.ctx)

  await appendDeviceLogRow(db, {
    ref_local: refLocal,
    created_at: nowIso,
    clock_offset_ms: input.clockOffsetMs ?? null,
    level: input.level,
    code: input.code,
    route: stripRouteQueryAndFragment(input.route),
    stack: sanitizeStack(input.stack),
    component_stack: sanitizeStack(input.componentStack),
    ctx: cleanCtx,
    app_version: APP_VERSION.slice(0, 30),
    schema_version: SCHEMA_VERSION,
    send_status: 'PENDING',
  })

  return refLocal
}
