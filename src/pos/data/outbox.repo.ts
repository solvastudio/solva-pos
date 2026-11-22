import Dexie, { liveQuery, type Table, type Transaction } from 'dexie'
import { APP_VERSION } from '~/lib/app-version'
import {
  type CommandType,
  type PullCommandUpdate,
  type PushResultItem,
} from '~/lib/contracts'
import { createIdGenerator } from '~/lib/kernel'
import type { SolvaDb } from '../db/solva-db'
import type { OutboxCommandRow } from '../db/types'
import { projectCommandAckToDocumentTx } from './command-projection'
import { DEVICE_SEQ_KEY, nextSeq } from './counter.repo'

export const DEFAULT_PUSH_BATCH_MAX = 20
export const DEFAULT_PUSH_BATCH_MAX_BYTES = 262_144

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})

function byteLengthUtf8(text: string): number {
  return new TextEncoder().encode(text).length
}

export interface EnqueueCommandInput {
  id?: string
  type: CommandType
  payload: unknown
  schemaVersion: number
  registerId: string
  dependencyKey?: string | null
  dependsOn?: string[]
  createdAtDevice: string
}

/**
 * Enqueues a command atomically inside the caller's active `rw` transaction
 * (requiring both `outbox_command` and `local_counter`). Never awaits non-IDB work.
 */
export async function enqueueCommand(
  tx: Transaction,
  input: EnqueueCommandInput,
): Promise<OutboxCommandRow> {
  const deviceSeq = await nextSeq(tx, DEVICE_SEQ_KEY, {
    registerId: input.registerId,
    updatedAt: input.createdAtDevice,
  })

  const row: OutboxCommandRow = {
    id: input.id ?? idGen.newId(),
    type: input.type,
    payload: input.payload,
    schema_version: input.schemaVersion,
    device_seq: deviceSeq,
    register_id: input.registerId,
    status: 'PENDING',
    dependency_key: input.dependencyKey ?? null,
    depends_on: [...(input.dependsOn ?? [])],
    attempts: 0,
    next_retry_at: null,
    last_error_class: null,
    last_error_code: null,
    last_error_ref: null,
    result: null,
    created_at_device: input.createdAtDevice,
    app_version: APP_VERSION.slice(0, 30),
  }

  const table: Table<OutboxCommandRow, string> = tx.table('outbox_command')
  await table.add(row)
  return row
}

export async function enqueueCommandStandalone(
  db: SolvaDb,
  input: EnqueueCommandInput,
): Promise<OutboxCommandRow> {
  return db.transaction('rw', db.outbox_command, db.local_counter, (tx) =>
    enqueueCommand(tx, input),
  )
}

/**
 * Returns FIFO sendable PENDING commands ordered by `[status+device_seq]`,
 * skipping commands held by future `next_retry_at`, SCHEMA holds, or un-ACKed parents,
 * up to `max` items and `maxBytes` serialized UTF-8 size.
 */
export async function listSendable(
  db: SolvaDb,
  opts?: { max?: number; maxBytes?: number; nowIso?: string },
): Promise<OutboxCommandRow[]> {
  const max = opts?.max ?? DEFAULT_PUSH_BATCH_MAX
  const maxBytes = opts?.maxBytes ?? DEFAULT_PUSH_BATCH_MAX_BYTES
  const nowIso = opts?.nowIso ?? new Date().toISOString()

  const pending = await db.outbox_command
    .where('[status+device_seq]')
    .between(['PENDING', Dexie.minKey], ['PENDING', Dexie.maxKey])
    .toArray()

  if (pending.length === 0) {
    return []
  }

  // Collect all referenced parent IDs so we can check whether they are ACKED in one batch.
  const parentIds = new Set<string>()
  for (const row of pending) {
    for (const dep of row.depends_on) {
      parentIds.add(dep)
    }
  }

  const ackedParents = new Set<string>()
  if (parentIds.size > 0) {
    const parentRows = await db.outbox_command.bulkGet([...parentIds])
    for (const p of parentRows) {
      if (p && p.status === 'ACKED') {
        ackedParents.add(p.id)
      }
    }
  }

  const selected: OutboxCommandRow[] = []
  let totalBytes = 0

  for (const row of pending) {
    if (selected.length >= max) break
    if (row.last_error_class === 'SCHEMA') continue
    if (row.next_retry_at && row.next_retry_at > nowIso) continue
    if (row.depends_on.some((depId) => !ackedParents.has(depId))) continue

    const entryBytes = byteLengthUtf8(JSON.stringify(row.payload ?? {})) + 256
    if (selected.length > 0 && totalBytes + entryBytes > maxBytes) {
      break
    }
    totalBytes += entryBytes
    selected.push(row)
  }

  return selected
}

export async function markOutboxSending(db: SolvaDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await db.transaction('rw', db.outbox_command, async () => {
    for (const id of ids) {
      await db.outbox_command.update(id, { status: 'SENDING' })
    }
  })
}

/**
 * Resets any interrupted `'SENDING'` commands back to `'PENDING'` on device boot.
 */
export async function resetSending(db: SolvaDb): Promise<number> {
  const stale = await db.outbox_command
    .where('[status+device_seq]')
    .between(['SENDING', Dexie.minKey], ['SENDING', Dexie.maxKey])
    .toArray()

  if (stale.length === 0) return 0
  await db.transaction('rw', db.outbox_command, async () => {
    for (const row of stale) {
      await db.outbox_command.update(row.id, { status: 'PENDING' })
    }
  })
  return stale.length
}

export async function applyOutboxResults(
  db: SolvaDb,
  results: readonly PushResultItem[],
  opts: {
    nowIso: string
    nextRetryAtIso: (attempts: number) => string
  },
): Promise<void> {
  if (results.length === 0) return
  await db.transaction(
    'rw',
    [db.outbox_command, db.sale, db.credit_note, db.shift, db.cash_movement],
    async (tx) => {
      const outboxTable = tx.table<OutboxCommandRow, string>('outbox_command')
      for (const item of results) {
        const current = await outboxTable.get(item.id)
        if (!current) continue

        if (item.outcome === 'ACK') {
          await outboxTable.update(item.id, {
            status: 'ACKED',
            acked_at: opts.nowIso,
            next_retry_at: null,
            last_error_class: null,
            last_error_code: null,
            last_error_ref: null,
            result: item.result,
          })
          await projectCommandAckToDocumentTx(tx, current, {
            ackedAtIso: opts.nowIso,
            result: item.result,
          })
        } else if (item.outcome === 'ATTENTION') {
          await outboxTable.update(item.id, {
            status: 'NEEDS_ATTENTION',
            last_error_class: item.reason_class,
            last_error_code: item.reason_code,
            last_error_ref: item.ref,
            next_retry_at: null,
          })
        } else if (item.outcome === 'RETRY') {
          const nextAttempts = current.attempts + 1
          await outboxTable.update(item.id, {
            status: 'PENDING',
            attempts: nextAttempts,
            next_retry_at: opts.nextRetryAtIso(nextAttempts),
            last_error_class: 'TRANSIENT',
          })
        } else if (item.outcome === 'HELD') {
          // HELD waits for parent ACK without burning retry attempts.
          await outboxTable.update(item.id, {
            status: 'PENDING',
            next_retry_at: null,
          })
        }
      }
    },
  )
}

export async function revertSendingToPending(
  db: SolvaDb,
  ids: readonly string[],
  opts: { incrementAttempts: boolean; nextRetryAtIso?: string | null },
): Promise<void> {
  if (ids.length === 0) return
  await db.transaction('rw', db.outbox_command, async () => {
    for (const id of ids) {
      const current = await db.outbox_command.get(id)
      if (!current) continue
      const nextAttempts = opts.incrementAttempts ? current.attempts + 1 : current.attempts
      await db.outbox_command.update(id, {
        status: 'PENDING',
        attempts: nextAttempts,
        ...(opts.nextRetryAtIso !== undefined ? { next_retry_at: opts.nextRetryAtIso } : {}),
      })
    }
  })
}

export type SchemaHoldCode = 'UPDATE_REQUIRED' | 'SERVER_BEHIND' | 'SCHEMA_NOT_MIGRATABLE'

export async function markSendingSchemaHeld(
  db: SolvaDb,
  ids: readonly string[],
  code: SchemaHoldCode = 'UPDATE_REQUIRED',
): Promise<void> {
  if (ids.length === 0) return
  await db.transaction('rw', db.outbox_command, async () => {
    for (const id of ids) {
      await db.outbox_command.update(id, {
        status: 'PENDING',
        last_error_class: 'SCHEMA',
        last_error_code: code,
        next_retry_at: null,
      })
    }
  })
}

export async function holdCommandsAboveServerSchema(
  db: SolvaDb,
  serverMaxSchema: number | null | undefined,
): Promise<number> {
  if (!serverMaxSchema || serverMaxSchema < 1) return 0
  const pending = await db.outbox_command
    .where('[status+device_seq]')
    .between(['PENDING', Dexie.minKey], ['PENDING', Dexie.maxKey])
    .toArray()

  const toHold = pending.filter(
    (row) => row.schema_version > serverMaxSchema && row.last_error_class !== 'SCHEMA',
  )
  if (toHold.length === 0) return 0

  await db.transaction('rw', db.outbox_command, async () => {
    for (const row of toHold) {
      await db.outbox_command.update(row.id, {
        last_error_class: 'SCHEMA',
        last_error_code: 'SERVER_BEHIND',
        next_retry_at: null,
      })
    }
  })
  return toHold.length
}

export async function releaseEligibleSchemaHolds(
  db: SolvaDb,
  opts: { serverMaxSchema?: number | null; updateRequired?: boolean },
): Promise<number> {
  if (opts.updateRequired) return 0
  const pending = await db.outbox_command
    .where('[status+device_seq]')
    .between(['PENDING', Dexie.minKey], ['PENDING', Dexie.maxKey])
    .toArray()

  const eligible = pending.filter((row) => {
    if (row.last_error_class !== 'SCHEMA') return false
    if (row.last_error_code === 'SCHEMA_NOT_MIGRATABLE') return false
    if (opts.serverMaxSchema != null && row.schema_version > opts.serverMaxSchema) return false
    return true
  })

  if (eligible.length === 0) return 0

  await db.transaction('rw', db.outbox_command, async () => {
    for (const row of eligible) {
      await db.outbox_command.update(row.id, {
        last_error_class: null,
        last_error_code: null,
      })
    }
  })
  return eligible.length
}

export async function applyPullCommandUpdates(
  db: SolvaDb,
  updates: readonly PullCommandUpdate[],
  ackedAtIso: string,
): Promise<void> {
  if (updates.length === 0) return
  await db.transaction('rw', db.outbox_command, async () => {
    for (const upd of updates) {
      if (upd.status === 'ACKED') {
        await db.outbox_command.update(upd.id, {
          status: 'ACKED',
          acked_at: ackedAtIso,
          next_retry_at: null,
          last_error_class: null,
          last_error_code: null,
          last_error_ref: null,
        })
      } else if (upd.status === 'NEEDS_ATTENTION') {
        await db.outbox_command.update(upd.id, {
          status: 'NEEDS_ATTENTION',
        })
      }
    }
  })
}

export async function getOutboxQueueSummary(db: SolvaDb): Promise<{
  pending: number
  oldestAt: string | null
  attention: number
  attentionIds: string[]
}> {
  const all = await db.outbox_command.toArray()
  let pending = 0
  let oldestAt: string | null = null
  const attentionIds: string[] = []

  for (const row of all) {
    if (row.status === 'NEEDS_ATTENTION') {
      attentionIds.push(row.id)
    } else if (row.status === 'PENDING' || row.status === 'SENDING') {
      if (row.last_error_class !== 'SCHEMA') {
        pending += 1
        if (oldestAt === null || row.created_at_device < oldestAt) {
          oldestAt = row.created_at_device
        }
      }
    }
  }

  return {
    pending,
    oldestAt,
    attention: attentionIds.length,
    attentionIds: attentionIds.slice(0, 100),
  }
}

/**
 * Returns the earliest `next_retry_at` ISO timestamp among non-SCHEMA `PENDING` commands,
 * or `null` when no command is waiting on a retry timer.
 */
export async function getEarliestDeferredRetryAt(db: SolvaDb): Promise<string | null> {
  const pending = await db.outbox_command
    .where('[status+device_seq]')
    .between(['PENDING', Dexie.minKey], ['PENDING', Dexie.maxKey])
    .toArray()

  let earliest: string | null = null
  for (const row of pending) {
    if (row.last_error_class === 'SCHEMA' || !row.next_retry_at) continue
    if (earliest === null || row.next_retry_at < earliest) {
      earliest = row.next_retry_at
    }
  }
  return earliest
}

/**
 * Observes outbox queue & sync metadata changes via Dexie `liveQuery` inside `pos/data`.
 */
export function subscribeSyncStateInputs(
  db: SolvaDb,
  onChange: () => void,
): () => void {
  const observable = liveQuery(async () => {
    const queue = await getOutboxQueueSummary(db)
    const lastSync = await db.meta.get('last_success_sync_at')
    const minSup = await db.meta.get('min_supported')
    const syncFlags = await db.meta.get('sync_flags')
    return {
      pending: queue.pending,
      oldestAt: queue.oldestAt,
      attention: queue.attention,
      lastSuccessAt: lastSync?.value ?? null,
      minSupported: minSup?.value ?? null,
      syncFlags: syncFlags?.value ?? null,
    }
  })

  const subscription = observable.subscribe({
    next: () => onChange(),
    error: () => {},
  })
  return () => {
    subscription.unsubscribe()
  }
}

export interface SanitizedOutboxQueueItem {
  readonly id: string
  readonly type: string
  readonly deviceSeq: number
  readonly status: OutboxCommandRow['status']
  readonly schemaHeld: boolean
  readonly schemaHoldCode: string | null
  readonly attempts: number
  readonly nextRetryAt: string | null
  readonly errorCode: string | null
  readonly errorClass: OutboxCommandRow['last_error_class']
  readonly errorRef: string | null
  readonly managerDecision: 'ACCEPTED_MANUAL' | 'DISMISSED' | null
  readonly referenceLabel: string
  readonly createdAtDevice: string
  readonly ackedAt: string | null
}

function extractSafeReferenceLabel(row: OutboxCommandRow): string {
  const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : null
  if (payload) {
    if (row.type === 'FinalizeSale') {
      const sale = payload.sale as Record<string, unknown> | undefined
      if (typeof sale?.invoice_no === 'string' && sale.invoice_no) return sale.invoice_no
    } else if (row.type === 'FinalizeCreditNote') {
      const cn = payload.credit_note as Record<string, unknown> | undefined
      if (typeof cn?.cn_no === 'string' && cn.cn_no) return cn.cn_no
    } else if (row.type === 'VoidSale') {
      const voidObj = payload.void as Record<string, unknown> | undefined
      if (typeof voidObj?.sale_id === 'string') return voidObj.sale_id.slice(-8)
    } else if (row.type === 'OpenShift' || row.type === 'CloseShift') {
      const sec = (payload.shift ?? payload.close) as Record<string, unknown> | undefined
      const sid = sec?.id ?? sec?.shift_id
      if (typeof sid === 'string') return sid.slice(-8)
    } else if (row.type === 'RecordCashMovement') {
      const mov = payload.movement as Record<string, unknown> | undefined
      if (typeof mov?.direction === 'string') return mov.direction
    }
  }
  return `#${row.device_seq}`
}

/**
 * Returns a sanitized projection of queue items for SCR-P14 (all non-ACKED rows plus
 * manager-resolved rows via `command_updates`), strictly omitting sensitive raw `payload` fields.
 */
export async function listSanitizedQueueItems(
  db: SolvaDb,
  opts?: { query?: string },
): Promise<SanitizedOutboxQueueItem[]> {
  const all = (await db.outbox_command.toArray()).sort((a, b) => a.device_seq - b.device_seq)
  const items: SanitizedOutboxQueueItem[] = []
  const q = opts?.query?.trim().toLowerCase() ?? ''

  for (const row of all) {
    const include = row.status !== 'ACKED' || row.manager_decision === 'ACCEPTED_MANUAL'
    if (!include) continue

    const schemaHeld = row.last_error_class === 'SCHEMA'
    const referenceLabel = extractSafeReferenceLabel(row)
    const entry: SanitizedOutboxQueueItem = {
      id: row.id,
      type: row.type,
      deviceSeq: row.device_seq,
      status: row.status,
      schemaHeld,
      schemaHoldCode: schemaHeld ? row.last_error_code : null,
      attempts: row.attempts,
      nextRetryAt: row.next_retry_at,
      errorCode: row.last_error_code,
      errorClass: row.last_error_class,
      errorRef: row.last_error_ref,
      managerDecision: row.manager_decision ?? null,
      referenceLabel,
      createdAtDevice: row.created_at_device,
      ackedAt: row.acked_at ?? null,
    }

    if (q) {
      const hay = `${entry.referenceLabel} ${entry.type} ${entry.errorCode ?? ''} ${entry.errorRef ?? ''} ${entry.id}`.toLowerCase()
      if (!hay.includes(q)) continue
    }
    items.push(entry)
  }

  return items
}

export async function listRawPendingOutboxRows(db: SolvaDb): Promise<OutboxCommandRow[]> {
  const all = (await db.outbox_command.toArray()).sort((a, b) => a.device_seq - b.device_seq)
  return all.filter((r) => r.status !== 'ACKED' && r.status !== 'DISMISSED')
}

export async function applyCommandUpdatesInDb(
  db: SolvaDb,
  updates: readonly PullCommandUpdate[],
  opts: { ackedAtIso: string },
): Promise<number> {
  if (updates.length === 0) return 0

  let applied = 0
  await db.transaction(
    'rw',
    [db.outbox_command, db.sale, db.credit_note, db.shift, db.cash_movement],
    async (tx) => {
      const outboxTable: Table<OutboxCommandRow, string> = tx.table('outbox_command')

      for (const upd of updates) {
        const current = await outboxTable.get(upd.id)
        if (!current) continue

        if (upd.status === 'ACCEPTED_MANUAL' || upd.status === 'ACKED') {
          const isManual = upd.status === 'ACCEPTED_MANUAL'
          const mergedResult: Record<string, unknown> = {
            ...(current.result ?? {}),
            ...(upd.result ?? {}),
            received_at: opts.ackedAtIso,
            ...(isManual ? { accepted_manual: true } : {}),
          }
          await outboxTable.update(upd.id, {
            status: 'ACKED',
            acked_at: opts.ackedAtIso,
            next_retry_at: null,
            last_error_class: null,
            last_error_code: null,
            last_error_ref: null,
            result: mergedResult,
            ...(isManual ? { manager_decision: 'ACCEPTED_MANUAL' } : {}),
          })
          await projectCommandAckToDocumentTx(tx, current, {
            ackedAtIso: opts.ackedAtIso,
            result: mergedResult,
          })
          applied += 1
        } else if (upd.status === 'DISMISSED') {
          await outboxTable.update(upd.id, {
            status: 'DISMISSED',
            manager_decision: 'DISMISSED',
            next_retry_at: null,
          })
          applied += 1
        } else if (upd.status === 'NEEDS_ATTENTION') {
          await outboxTable.update(upd.id, {
            status: 'NEEDS_ATTENTION',
            last_error_class: upd.reason_class ?? current.last_error_class ?? 'STRUCTURAL',
            last_error_code: upd.reason_code ?? current.last_error_code ?? 'UNKNOWN_REFERENCE',
            last_error_ref: upd.ref ?? current.last_error_ref,
            next_retry_at: null,
          })
          applied += 1
        }
      }
    },
  )

  return applied
}

/** All `outbox_command` rows (E2E/diagnostic hook only; not used by the cashier flow). */
export async function listAllOutboxRows(db: SolvaDb): Promise<OutboxCommandRow[]> {
  return db.outbox_command.toArray()
}
