import { PushResponse } from '~/lib/contracts'
import { getMeta } from '../data/meta.repo'
import {
  applyOutboxResults,
  DEFAULT_PUSH_BATCH_MAX_BYTES,
  holdCommandsAboveServerSchema,
  listSendable,
  markOutboxSending,
  markSendingSchemaHeld,
  releaseEligibleSchemaHolds,
  revertSendingToPending,
} from '../data/outbox.repo'
import type { SolvaDb } from '../db/solva-db'
import { nextDelayMs } from './backoff'
import type { SyncClock } from './clock'
import { deviceFetch, type DeviceAuthFailureCode } from './device-http'

export const NORMAL_PUSH_BATCH_SIZE = 20
export const UNSTABLE_PUSH_BATCH_SIZE = 5
export const NORMAL_PUSH_TIMEOUT_MS = 15_000
export const UNSTABLE_PUSH_TIMEOUT_MS = 25_000

export type PushRunResult =
  | { kind: 'ok'; pushOk: boolean; sentCount: number; serverTimeMs?: number }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'auth'; code: DeviceAuthFailureCode }
  | { kind: 'update_required' }
  | { kind: 'transient' }

export interface RunPushOptions {
  db: SolvaDb
  clock: SyncClock
  unstable?: boolean
  rng?: () => number
  fetch?: typeof fetch
  onAuthTerminal?: (code: 'DEVICE_REVOKED' | 'CREDENTIAL_EXPIRED' | 'TENANT_SUSPENDED') => void
}

/**
 * Drains sendable outbox commands in FIFO order (20/15s normal, 5/25s when UNSTABLE),
 * classifies every server outcome (`ACK`/`ATTENTION`/`RETRY`/`HELD`), and leaves `429`/`HELD`
 * retry counters untouched.
 */
export async function runPush(opts: RunPushOptions): Promise<PushRunResult> {
  const maxBatch = opts.unstable ? UNSTABLE_PUSH_BATCH_SIZE : NORMAL_PUSH_BATCH_SIZE
  const timeoutMs = opts.unstable ? UNSTABLE_PUSH_TIMEOUT_MS : NORMAL_PUSH_TIMEOUT_MS
  const rng = opts.rng ?? (() => 0.5)

  let totalSent = 0
  let overallPushOk = true
  let lastServerTimeMs: number | undefined

  while (true) {
    const nowMs = opts.clock.trustedNow()
    const nowIso = new Date(nowMs).toISOString()

    const flags = await getMeta(opts.db, 'sync_flags')
    await releaseEligibleSchemaHolds(opts.db, {
      serverMaxSchema: flags?.server_max_schema ?? null,
      updateRequired: flags?.update_required ?? false,
    })
    if (flags?.server_max_schema) {
      await holdCommandsAboveServerSchema(opts.db, flags.server_max_schema)
    }

    const batch = await listSendable(opts.db, {
      max: maxBatch,
      maxBytes: DEFAULT_PUSH_BATCH_MAX_BYTES,
      nowIso,
    })

    if (batch.length === 0) {
      return {
        kind: 'ok',
        pushOk: overallPushOk,
        sentCount: totalSent,
        serverTimeMs: lastServerTimeMs,
      }
    }

    const batchIds = batch.map((r) => r.id)
    await markOutboxSending(opts.db, batchIds)

    const res = await deviceFetch<unknown>('/api/pos/v1/push', {
      method: 'POST',
      db: opts.db,
      clock: opts.clock,
      timeoutMs,
      fetch: opts.fetch,
      onTerminalAuthLock: opts.onAuthTerminal,
      body: {
        sent_at_device: nowIso,
        clock_offset_ms: Math.round(opts.clock.getOffsetMs()),
        commands: batch.map((cmd) => ({
          id: cmd.id,
          type: cmd.type,
          schema_version: cmd.schema_version,
          device_seq: cmd.device_seq,
          depends_on: cmd.depends_on,
          created_at_device: cmd.created_at_device,
          payload: cmd.payload,
        })),
      },
    })

    if (res.kind === 'rate_limited') {
      const delayMs = Math.max(res.retryAfterMs, nextDelayMs(0, rng))
      await revertSendingToPending(opts.db, batchIds, {
        incrementAttempts: false,
        nextRetryAtIso: new Date(nowMs + delayMs).toISOString(),
      })
      return { kind: 'rate_limited', retryAfterMs: delayMs }
    }

    if (res.kind === 'auth') {
      await revertSendingToPending(opts.db, batchIds, { incrementAttempts: false })
      return { kind: 'auth', code: res.code }
    }

    if (res.kind === 'update_required') {
      await markSendingSchemaHeld(opts.db, batchIds, 'UPDATE_REQUIRED')
      return { kind: 'update_required' }
    }

    if (res.kind !== 'ok') {
      await revertSendingToPending(opts.db, batchIds, {
        incrementAttempts: true,
        nextRetryAtIso: new Date(nowMs + nextDelayMs(0, rng)).toISOString(),
      })
      return { kind: 'transient' }
    }

    const parsed = PushResponse.parse(res.data)
    lastServerTimeMs = res.serverTimeMs ?? Date.parse(parsed.server_time)
    const ackedIso = new Date(lastServerTimeMs).toISOString()

    await applyOutboxResults(opts.db, parsed.results, {
      nowIso: ackedIso,
      nextRetryAtIso: (attempts) =>
        new Date(nowMs + nextDelayMs(Math.max(0, attempts - 1), rng)).toISOString(),
    })

    if (parsed.results.some((r) => r.outcome === 'RETRY' || r.outcome === 'HELD')) {
      overallPushOk = false
    }
    totalSent += batch.length

    // Commands that depend on this batch (e.g. CloseShift) can only be sent after the ACK.
    // Continue while there is progress (ACK) and no RETRY/HELD; the next listSendable
    // returns [] when nothing else can be sent.
    const ackedInBatch = parsed.results.filter((r) => r.outcome === 'ACK').length
    if (!overallPushOk || ackedInBatch === 0) {
      return {
        kind: 'ok',
        pushOk: overallPushOk,
        sentCount: totalSent,
        serverTimeMs: lastServerTimeMs,
      }
    }
  }
}
