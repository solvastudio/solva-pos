import { liveQuery, type Observable, type Table, type Transaction } from 'dexie'
import type { SolvaDb } from '../db/solva-db'
import type { PrintJobRecord } from '../db/types'

export async function enqueuePrintJob(
  tx: Transaction,
  job: PrintJobRecord,
): Promise<void> {
  const table: Table<PrintJobRecord, string> = tx.table('print_job')
  await table.add(job)
}

export async function getPrintJobForEntity(
  db: SolvaDb,
  entityId: string,
): Promise<PrintJobRecord | null> {
  const row = await db.print_job.where('entity_id').equals(entityId).first()
  return row ?? null
}

export function observePrintJobForEntity(
  db: SolvaDb,
  entityId: string,
): Observable<PrintJobRecord | null> {
  return liveQuery(() => getPrintJobForEntity(db, entityId))
}
