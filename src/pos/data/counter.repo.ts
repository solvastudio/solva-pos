import type { Transaction } from 'dexie'
import type { SolvaDb } from '../db/solva-db'
import type { LocalCounterRow } from '../db/types'

export const DEVICE_SEQ_KEY = 'device_seq'

export function invoiceCounterKey(registerId: string, mmYy: string): string {
  return `${registerId}|INVOICE|${mmYy}`
}

export function creditNoteCounterKey(registerId: string, mmYy: string): string {
  return `${registerId}|CREDIT_NOTE|${mmYy}`
}

export function billSeqCounterKey(billId: string): string {
  return `${billId}|bill_seq`
}

export interface NextSeqMeta {
  registerId?: string | null
  docType?: string | null
  period?: string | null
  updatedAt?: string
}

/**
 * Atomically reads and increments `local_counter` within the caller's active `rw` transaction.
 * CRITICAL (AD-14): never perform non-IDB `await` (fetch/timer/Promise.resolve across macrotasks)
 * inside the calling IndexedDB transaction, or IndexedDB will auto-commit early.
 */
export async function nextSeq(
  tx: Transaction,
  key: string,
  meta?: NextSeqMeta,
): Promise<number> {
  const table = tx.table<LocalCounterRow, string>('local_counter')
  const existing = await table.get(key)
  const next = (existing?.last_seq ?? 0) + 1

  await table.put({
    key,
    register_id: meta?.registerId ?? existing?.register_id ?? null,
    doc_type: meta?.docType ?? existing?.doc_type ?? null,
    period: meta?.period ?? existing?.period ?? null,
    last_seq: next,
    updated_at: meta?.updatedAt ?? existing?.updated_at ?? '',
  })

  return next
}

export async function peekSeq(db: SolvaDb, key: string): Promise<number> {
  const row = await db.local_counter.get(key)
  return row?.last_seq ?? 0
}

export async function seedSeq(
  db: SolvaDb,
  key: string,
  lastSeq: number,
  meta?: NextSeqMeta,
): Promise<void> {
  if (!Number.isInteger(lastSeq) || lastSeq < 0) {
    throw new Error(`Invalid initial sequence number: ${lastSeq}`)
  }
  await db.local_counter.put({
    key,
    register_id: meta?.registerId ?? null,
    doc_type: meta?.docType ?? null,
    period: meta?.period ?? null,
    last_seq: lastSeq,
    updated_at: meta?.updatedAt ?? '',
  })
}
