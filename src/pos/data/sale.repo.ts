import type { Table } from 'dexie'
import {
  SCHEMA_VERSION,
  type AppendAuditPayloadV1,
  type FinalizeSalePayloadV1,
} from '~/lib/contracts'
import { formatInvoiceNo } from '~/lib/kernel'
import type { SolvaDb } from '../db/solva-db'
import type {
  CartDraftRecord,
  OutboxCommandRow,
  PrintJobRecord,
  SaleLineRecord,
  SalePaymentRecord,
  SaleRecord,
  ShiftRecord,
} from '../db/types'
import { invoiceCounterKey, nextSeq } from './counter.repo'
import { enqueueCommand } from './outbox.repo'
import { enqueuePrintJob } from './print-job.repo'

export class InvoiceConflictError extends Error {
  constructor(invoiceNo: string) {
    super(`Local invoice_no collision: ${invoiceNo}`)
    this.name = 'InvoiceConflictError'
  }
}

export async function getSaleById(
  db: SolvaDb,
  saleId: string,
): Promise<SaleRecord | null> {
  const row = await db.sale.get(saleId)
  return row ?? null
}

export async function getSaleWithDetails(
  db: SolvaDb,
  saleId: string,
): Promise<{
  sale: SaleRecord
  lines: SaleLineRecord[]
  payments: SalePaymentRecord[]
  printJob: PrintJobRecord | null
} | null> {
  const sale = await db.sale.get(saleId)
  if (!sale) return null
  const [lines, payments, printJob] = await Promise.all([
    db.sale_line.where('sale_id').equals(saleId).sortBy('line_no'),
    db.sale_payment.where('sale_id').equals(saleId).sortBy('seq'),
    db.print_job.where('entity_id').equals(saleId).first(),
  ])
  return {
    sale,
    lines,
    payments,
    printJob: printJob ?? null,
  }
}

export async function getUnackedOpenShiftCommandId(
  db: SolvaDb,
  shift: ShiftRecord,
): Promise<string | null> {
  if (shift.open_command_id) {
    const cmd = await db.outbox_command.get(shift.open_command_id)
    if (cmd && cmd.status !== 'ACKED') {
      return cmd.id
    }
    return null
  }
  const byDep = await db.outbox_command
    .where('dependency_key')
    .equals(`shift:${shift.id}`)
    .filter((c) => c.type === 'OpenShift' && c.status !== 'ACKED')
    .first()
  return byDep?.id ?? null
}

export interface AtomicFinalizeTxInput {
  saleRecord: SaleRecord
  lineRecords: readonly SaleLineRecord[]
  paymentRecords: readonly SalePaymentRecord[]
  payload: FinalizeSalePayloadV1
  auditEntries: readonly { id: string; payload: AppendAuditPayloadV1 }[]
  printJob: PrintJobRecord
  invoicePrefix: string
  invoicePeriod: string
  registerId: string
  staffId: string
  createdAtDevice: string
  shiftOpenCommandId: string | null
  beforeCommitHookForTest?: () => Promise<void> | void
}

/**
 * Stage B (AD-14): single strict `rw` IndexedDB transaction across 7 stores.
 * Never performs non-IDB awaits inside; full rollback on any failure preserves invoice counter.
 */
export async function commitAtomicSaleTransaction(
  db: SolvaDb,
  input: AtomicFinalizeTxInput,
): Promise<{
  alreadyCommitted: boolean
  sale: SaleRecord
  payments: SalePaymentRecord[]
}> {
  return db.transaction(
    'rw',
    [
      db.local_counter,
      db.sale,
      db.sale_line,
      db.sale_payment,
      db.outbox_command,
      db.print_job,
      db.cart_draft,
    ],
    async (tx) => {
      const saleTable: Table<SaleRecord, string> = tx.table('sale')
      const payTable: Table<SalePaymentRecord, string> = tx.table('sale_payment')

      const existing = await saleTable.get(input.saleRecord.id)
      if (existing) {
        const existingPayments = await payTable.where('sale_id').equals(existing.id).sortBy('seq')
        return {
          alreadyCommitted: true,
          sale: existing,
          payments: existingPayments,
        }
      }

      const seq = await nextSeq(
        tx,
        invoiceCounterKey(input.registerId, input.invoicePeriod),
        {
          registerId: input.registerId,
          docType: 'INVOICE',
          period: input.invoicePeriod,
          updatedAt: input.createdAtDevice,
        },
      )

      const invoiceNo = formatInvoiceNo({
        prefix: input.invoicePrefix,
        kind: 'INVOICE',
        period: input.invoicePeriod,
        seq,
      })

      const collision = await saleTable.where('invoice_no').equals(invoiceNo).first()
      if (collision) {
        throw new InvoiceConflictError(invoiceNo)
      }

      const finalSale: SaleRecord = {
        ...input.saleRecord,
        invoice_seq: seq,
        invoice_no: invoiceNo,
      }

      const finalPayload: FinalizeSalePayloadV1 = {
        ...input.payload,
        sale: {
          ...input.payload.sale,
          invoice_seq: seq,
          invoice_no: invoiceNo,
        },
      }

      await saleTable.add(finalSale)
      await tx.table<SaleLineRecord, string>('sale_line').bulkAdd([...input.lineRecords])
      await payTable.bulkAdd([...input.paymentRecords])

      await enqueueCommand(tx, {
        id: finalSale.id,
        type: 'FinalizeSale',
        payload: finalPayload,
        schemaVersion: SCHEMA_VERSION,
        registerId: input.registerId,
        dependencyKey: `sale:${finalSale.id}`,
        dependsOn: input.shiftOpenCommandId ? [input.shiftOpenCommandId] : [],
        createdAtDevice: input.createdAtDevice,
      })

      for (const audit of input.auditEntries) {
        await enqueueCommand(tx, {
          id: audit.id,
          type: 'AppendAudit',
          payload: audit.payload,
          schemaVersion: SCHEMA_VERSION,
          registerId: input.registerId,
          dependencyKey: `audit:${finalSale.id}`,
          dependsOn: [finalSale.id],
          createdAtDevice: input.createdAtDevice,
        })
      }

      await enqueuePrintJob(tx, input.printJob)

      if (input.beforeCommitHookForTest) {
        await input.beforeCommitHookForTest()
      }

      const draftTable: Table<CartDraftRecord, string> = tx.table('cart_draft')
      await draftTable
        .where('[register_id+staff_id+status]')
        .equals([input.registerId, input.staffId, 'ACTIVE'])
        .modify({ status: 'USED', updated_at: input.createdAtDevice })

      return {
        alreadyCommitted: false,
        sale: finalSale,
        payments: [...input.paymentRecords],
      }
    },
  )
}

export async function listSaleOutboxCommands(
  db: SolvaDb,
  saleId: string,
): Promise<OutboxCommandRow[]> {
  return db.outbox_command.where('dependency_key').equals(`sale:${saleId}`).toArray()
}
