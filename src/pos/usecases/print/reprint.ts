import { type LocaleId } from '~/lib/kernel'
import { runtimeIdGenerator as idGen } from '~/lib/runtime-id'
import { getCreditNoteWithDetails } from '../../data/credit-note.repo'
import { addPrintJob } from '../../data/print-job.repo'
import { getSaleWithDetails } from '../../data/sale.repo'
import type { SolvaDb } from '../../db/solva-db'
import type { PrintJobRecord } from '../../db/types'

/**
 * Enqueues a `REPRINT` job preserving the original document's `receipt_locale` (FR-I18N-005 / FR-PRN-004).
 */
export async function reprintSale(
  db: SolvaDb,
  saleId: string,
  nowIso: string = new Date().toISOString(),
): Promise<PrintJobRecord> {
  const details = await getSaleWithDetails(db, saleId)
  if (!details) {
    throw new Error(`Sale ${saleId} not found`)
  }
  const locale: LocaleId = details.sale.receipt_locale === 'en-US' ? 'en-US' : 'id-ID'
  const job: PrintJobRecord = {
    id: idGen.newId(),
    kind: 'REPRINT',
    status: 'QUEUED',
    entity_id: saleId,
    entity_type: 'SALE',
    receipt_locale: locale,
    attempts: 0,
    last_error: null,
    created_at: nowIso,
    updated_at: nowIso,
  }
  await addPrintJob(db, job)
  return job
}

export async function reprintCreditNote(
  db: SolvaDb,
  creditNoteId: string,
  nowIso: string = new Date().toISOString(),
): Promise<PrintJobRecord> {
  const details = await getCreditNoteWithDetails(db, creditNoteId)
  if (!details) {
    throw new Error(`Credit note ${creditNoteId} not found`)
  }
  const locale: LocaleId = details.creditNote.receipt_locale === 'en-US' ? 'en-US' : 'id-ID'
  const job: PrintJobRecord = {
    id: idGen.newId(),
    kind: 'REPRINT',
    status: 'QUEUED',
    entity_id: creditNoteId,
    entity_type: 'CREDIT_NOTE',
    receipt_locale: locale,
    attempts: 0,
    last_error: null,
    created_at: nowIso,
    updated_at: nowIso,
  }
  await addPrintJob(db, job)
  return job
}
