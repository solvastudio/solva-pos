import Dexie, { liveQuery, type Observable, type Table, type Transaction } from 'dexie'
import type { SolvaDb } from '../db/solva-db'
import type { PrintJobRecord } from '../db/types'

export async function enqueuePrintJob(
  tx: Transaction,
  job: PrintJobRecord,
): Promise<void> {
  const table: Table<PrintJobRecord, string> = tx.table('print_job')
  await table.add(job)
}

export async function addPrintJob(
  db: SolvaDb,
  job: PrintJobRecord,
): Promise<void> {
  await db.transaction('rw', [db.print_job], async (tx) => {
    await enqueuePrintJob(tx, job)
  })
}

export async function enqueueReprintJob(
  db: SolvaDb,
  job: PrintJobRecord,
): Promise<void> {
  await addPrintJob(db, job)
}

export async function getPrintJobById(
  db: SolvaDb,
  id: string,
): Promise<PrintJobRecord | null> {
  const row = await db.print_job.get(id)
  return row ?? null
}

export async function getPrintJobForEntity(
  db: SolvaDb,
  entityId: string,
): Promise<PrintJobRecord | null> {
  const rows = await db.print_job.where('entity_id').equals(entityId).toArray()
  const nonDrawer = rows.filter((r) => r.kind !== 'CASH_DRAWER')
  const list = nonDrawer.length > 0 ? nonDrawer : rows
  if (list.length === 0) return null
  list.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return list[0] ?? null
}

export function observePrintJobForEntity(
  db: SolvaDb,
  entityId: string,
): Observable<PrintJobRecord | null> {
  return liveQuery(() => getPrintJobForEntity(db, entityId))
}

export async function listQueuedPrintJobs(db: SolvaDb): Promise<PrintJobRecord[]> {
  return db.print_job
    .where('[status+created_at]')
    .between(['QUEUED', Dexie.minKey], ['QUEUED', Dexie.maxKey])
    .toArray()
}

export async function listFailedPrintJobs(db: SolvaDb): Promise<PrintJobRecord[]> {
  return db.print_job
    .where('[status+created_at]')
    .between(['FAILED', Dexie.minKey], ['FAILED', Dexie.maxKey])
    .toArray()
}

export function observeFailedPrintJobs(db: SolvaDb): Observable<PrintJobRecord[]> {
  return liveQuery(() => listFailedPrintJobs(db))
}

export async function recoverStalePrintingJobs(
  db: SolvaDb,
  nowIso: string,
): Promise<number> {
  const stuck = await db.print_job
    .where('[status+created_at]')
    .between(['PRINTING', Dexie.minKey], ['PRINTING', Dexie.maxKey])
    .toArray()
  if (stuck.length === 0) return 0
  await db.print_job.bulkPut(
    stuck.map((job) => ({
      ...job,
      status: 'QUEUED' as const,
      updated_at: nowIso,
    })),
  )
  return stuck.length
}

export async function claimNextPrintJob(
  db: SolvaDb,
  nowIso: string,
): Promise<PrintJobRecord | null> {
  return db.transaction('rw', [db.print_job], async (tx) => {
    const table = tx.table<PrintJobRecord, string>('print_job')
    const queued = await table
      .where('[status+created_at]')
      .between(['QUEUED', Dexie.minKey], ['QUEUED', Dexie.maxKey])
      .toArray()
    if (queued.length === 0) return null

    // Execute CASH_DRAWER ahead of other pending jobs with the same or earlier trigger, FIFO otherwise.
    queued.sort((a, b) => {
      if (a.kind === 'CASH_DRAWER' && b.kind !== 'CASH_DRAWER') return -1
      if (b.kind === 'CASH_DRAWER' && a.kind !== 'CASH_DRAWER') return 1
      return a.created_at.localeCompare(b.created_at)
    })

    const next = queued[0]!
    const claimed: PrintJobRecord = {
      ...next,
      status: 'PRINTING',
      attempts: next.attempts + 1,
      updated_at: nowIso,
    }
    await table.put(claimed)
    return claimed
  })
}

export async function markPrintJobDone(
  db: SolvaDb,
  id: string,
  meta: { firstByteAt: string; doneAt: string },
): Promise<void> {
  await db.print_job.update(id, {
    status: 'DONE',
    last_error: null,
    first_byte_at: meta.firstByteAt,
    done_at: meta.doneAt,
    updated_at: meta.doneAt,
  })
}

export async function requeuePrintJobForRetry(
  db: SolvaDb,
  id: string,
  errorMsg: string,
  nowIso: string,
): Promise<void> {
  await db.print_job.update(id, {
    status: 'QUEUED',
    last_error: errorMsg,
    updated_at: nowIso,
  })
}

export async function markPrintJobFailed(
  db: SolvaDb,
  id: string,
  errorMsg: string,
  nowIso: string,
): Promise<void> {
  await db.print_job.update(id, {
    status: 'FAILED',
    last_error: errorMsg,
    updated_at: nowIso,
  })
}

export async function dismissPrintJob(db: SolvaDb, id: string): Promise<void> {
  await db.print_job.delete(id)
}

/** Seluruh baris `print_job` (khusus hook E2E/diagnostik; tidak dipakai alur kasir). */
export async function listAllPrintJobs(db: SolvaDb): Promise<PrintJobRecord[]> {
  return db.print_job.toArray()
}
