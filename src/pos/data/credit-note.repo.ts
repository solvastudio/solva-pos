import type { Table } from 'dexie'
import {
  SCHEMA_VERSION,
  type AppendAuditPayloadV1,
  type FinalizeCreditNotePayloadV1,
} from '~/lib/contracts'
import { addQty, formatInvoiceNo, normalizeQty, parseQty } from '~/lib/kernel'
import type { SolvaDb } from '../db/solva-db'
import type {
  CreditNoteLineRecord,
  CreditNoteRecord,
  CreditNoteRefundRecord,
  PrintJobRecord,
} from '../db/types'
import { creditNoteCounterKey, nextSeq } from './counter.repo'
import { enqueueCommand } from './outbox.repo'
import { enqueuePrintJob } from './print-job.repo'

export async function getCreditNoteWithDetails(
  db: SolvaDb,
  creditNoteId: string,
): Promise<{
  creditNote: CreditNoteRecord
  lines: CreditNoteLineRecord[]
  refunds: CreditNoteRefundRecord[]
  printJob: PrintJobRecord | null
} | null> {
  const cn = await db.credit_note.get(creditNoteId)
  if (!cn) return null
  const [lines, refunds, printJob] = await Promise.all([
    db.credit_note_line.where('credit_note_id').equals(creditNoteId).sortBy('line_no'),
    db.credit_note_refund.where('credit_note_id').equals(creditNoteId).sortBy('seq'),
    db.print_job.where('entity_id').equals(creditNoteId).first(),
  ])
  return {
    creditNote: cn,
    lines,
    refunds,
    printJob: printJob ?? null,
  }
}

export async function getLocalReturnedSumsBySaleLine(
  db: SolvaDb,
  saleLineIds: readonly string[],
): Promise<
  Map<string, { qty: string; net: number; sc: number; tax: number }>
> {
  const out = new Map<string, { qty: string; net: number; sc: number; tax: number }>()
  if (saleLineIds.length === 0) return out
  const rows = await db.credit_note_line
    .where('sale_line_id')
    .anyOf([...saleLineIds])
    .toArray()

  for (const row of rows) {
    const prev = out.get(row.sale_line_id)
    if (!prev) {
      out.set(row.sale_line_id, {
        qty: normalizeQty(parseQty(row.qty_returned)),
        net: row.refund_net,
        sc: row.refund_service,
        tax: row.refund_tax,
      })
    } else {
      out.set(row.sale_line_id, {
        qty: normalizeQty(addQty(parseQty(prev.qty), parseQty(row.qty_returned))),
        net: prev.net + row.refund_net,
        sc: prev.sc + row.refund_service,
        tax: prev.tax + row.refund_tax,
      })
    }
  }
  return out
}

export async function listCreditNoteRefundsForShift(
  db: SolvaDb,
  shiftId: string,
): Promise<CreditNoteRefundRecord[]> {
  return db.credit_note_refund.where('shift_id').equals(shiftId).toArray()
}

export interface AtomicCreditNoteTxInput {
  creditNote: CreditNoteRecord
  lines: readonly CreditNoteLineRecord[]
  refunds: readonly CreditNoteRefundRecord[]
  payload: FinalizeCreditNotePayloadV1
  auditCommandId: string
  auditPayload: AppendAuditPayloadV1
  printJob: PrintJobRecord
  cnPrefix: string
  cnPeriod: string
  registerId: string
  createdAtDevice: string
  dependsOnCommandIds: readonly string[]
}

export async function commitCreditNoteTransaction(
  db: SolvaDb,
  input: AtomicCreditNoteTxInput,
): Promise<CreditNoteRecord> {
  return db.transaction(
    'rw',
    [
      db.local_counter,
      db.credit_note,
      db.credit_note_line,
      db.credit_note_refund,
      db.outbox_command,
      db.print_job,
    ],
    async (tx) => {
      const seq = await nextSeq(
        tx,
        creditNoteCounterKey(input.registerId, input.cnPeriod),
        {
          registerId: input.registerId,
          docType: 'CREDIT_NOTE',
          period: input.cnPeriod,
          updatedAt: input.createdAtDevice,
        },
      )

      const cnNo = formatInvoiceNo({
        prefix: input.cnPrefix,
        kind: 'CREDIT_NOTE',
        period: input.cnPeriod,
        seq,
      })

      const finalCn: CreditNoteRecord = {
        ...input.creditNote,
        cn_seq: seq,
        cn_no: cnNo,
      }

      const finalPayload: FinalizeCreditNotePayloadV1 = {
        ...input.payload,
        credit_note: {
          ...input.payload.credit_note,
          cn_seq: seq,
          cn_no: cnNo,
        },
      }

      const cnTable: Table<CreditNoteRecord, string> = tx.table('credit_note')
      await cnTable.add(finalCn)
      await tx.table<CreditNoteLineRecord, string>('credit_note_line').bulkAdd([...input.lines])
      await tx
        .table<CreditNoteRefundRecord, string>('credit_note_refund')
        .bulkAdd([...input.refunds])

      await enqueueCommand(tx, {
        id: finalCn.id,
        type: 'FinalizeCreditNote',
        payload: finalPayload,
        schemaVersion: SCHEMA_VERSION,
        registerId: input.registerId,
        dependencyKey: `sale:${finalCn.original_sale_id}`,
        dependsOn: [...input.dependsOnCommandIds],
        createdAtDevice: input.createdAtDevice,
      })

      await enqueueCommand(tx, {
        id: input.auditCommandId,
        type: 'AppendAudit',
        payload: input.auditPayload,
        schemaVersion: SCHEMA_VERSION,
        registerId: input.registerId,
        dependencyKey: `audit:${finalCn.id}`,
        dependsOn: [finalCn.id],
        createdAtDevice: input.createdAtDevice,
      })

      await enqueuePrintJob(tx, input.printJob)

      return finalCn
    },
  )
}
