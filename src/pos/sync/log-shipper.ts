import { DeviceLogRequestSchema, DeviceLogResponseSchema } from '~/lib/contracts'
import { markDeviceLogSent, takePendingDeviceLogBatch } from '../data/device-log.repo'
import type { SolvaDb } from '../db/solva-db'
import type { SyncClock } from './clock'
import { deviceFetch, type DeviceAuthFailureCode } from './device-http'

export const DEFAULT_LOG_SHIP_BATCH = 100

export type LogShipResult =
  | { readonly kind: 'ok'; readonly sent: number }
  | { readonly kind: 'auth'; readonly code: DeviceAuthFailureCode }
  | { readonly kind: 'deferred'; readonly reason: string }

export interface RunLogShipperOptions {
  db: SolvaDb
  clock: SyncClock
  batchLimit?: number
  fetch?: typeof fetch
  onAuthTerminal?: (code: 'DEVICE_REVOKED' | 'CREDENTIAL_EXPIRED' | 'TENANT_SUSPENDED') => void
}

/**
 * Ships up to 100 pending `device_log` rows per sync cycle to `POST /api/pos/v1/device-log`.
 * Never blocks push/pull, never alters `last_success_sync_at`, and leaves rows `PENDING`
 * on 429/5xx/network errors without raising any "needs attention" status (FR-ERR-005..009).
 */
export async function runDeviceLogShipper(opts: RunLogShipperOptions): Promise<LogShipResult> {
  const limit = Math.max(1, Math.min(DEFAULT_LOG_SHIP_BATCH, opts.batchLimit ?? DEFAULT_LOG_SHIP_BATCH))
  const batch = await takePendingDeviceLogBatch(opts.db, limit)
  if (batch.length === 0) {
    return { kind: 'ok', sent: 0 }
  }

  const entries = batch.map((row) => ({
    ref_local: row.ref_local,
    created_at: row.created_at,
    clock_offset_ms: row.clock_offset_ms,
    level: row.level,
    code: row.code,
    route: row.route,
    stack: row.stack,
    component_stack: row.component_stack ?? null,
    ctx: row.ctx ?? {},
    app_version: row.app_version,
    schema_version: row.schema_version,
  }))

  const parsedBody = DeviceLogRequestSchema.safeParse({ entries })
  if (!parsedBody.success) {
    return { kind: 'deferred', reason: 'invalid_local_entries' }
  }

  const res = await deviceFetch<unknown>('/api/pos/v1/device-log', {
    method: 'POST',
    db: opts.db,
    clock: opts.clock,
    fetch: opts.fetch,
    timeoutMs: 10_000,
    onTerminalAuthLock: opts.onAuthTerminal,
    body: parsedBody.data,
  })

  if (res.kind === 'auth') {
    return { kind: 'auth', code: res.code }
  }

  if (res.kind !== 'ok') {
    return { kind: 'deferred', reason: res.kind }
  }

  const parsedRes = DeviceLogResponseSchema.safeParse(res.data)
  if (!parsedRes.success) {
    return { kind: 'deferred', reason: 'malformed_response' }
  }

  const sentIds = batch
    .map((r) => r.id)
    .filter((id): id is number => typeof id === 'number')
  await markDeviceLogSent(opts.db, sentIds)

  return { kind: 'ok', sent: batch.length }
}
