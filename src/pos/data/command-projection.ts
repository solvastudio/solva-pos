import type { Table, Transaction } from 'dexie'
import type {
  CashMovementRecord,
  CreditNoteRecord,
  OutboxCommandRow,
  SaleRecord,
  ShiftRecord,
} from '../db/types'

function extractPayloadId(cmd: OutboxCommandRow, key: string): string | null {
  if (!cmd.payload || typeof cmd.payload !== 'object') return null
  const section = (cmd.payload as Record<string, unknown>)[key]
  if (!section || typeof section !== 'object') return null
  const id = (section as Record<string, unknown>).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Mirrors an ACKed / manually-accepted outbox command outcome onto its corresponding
 * local Dexie document (`sale`, `credit_note`, `shift`, `cash_movement`), including
 * any server-reassigned conflict invoice number (`-Dn`, BR-POS-006).
 * Must run inside an active `rw` transaction covering all 4 entity tables.
 */
export async function projectCommandAckToDocumentTx(
  tx: Transaction,
  cmd: OutboxCommandRow,
  opts: { ackedAtIso: string; result?: Record<string, unknown> | null },
): Promise<void> {
  const result = opts.result ?? null
  const saleTable: Table<SaleRecord, string> = tx.table('sale')
  const cnTable: Table<CreditNoteRecord, string> = tx.table('credit_note')
  const shiftTable: Table<ShiftRecord, string> = tx.table('shift')
  const cashTable: Table<CashMovementRecord, string> = tx.table('cash_movement')

  if (cmd.type === 'FinalizeSale') {
    const saleId =
      (result && typeof result.sale_id === 'string' ? result.sale_id : null) ??
      extractPayloadId(cmd, 'sale')
    if (!saleId) return
    const existing = await saleTable.get(saleId)
    if (!existing) return
    const reassignedNo =
      result && typeof result.invoice_no === 'string' && result.invoice_no.length > 0
        ? result.invoice_no
        : null
    await saleTable.update(saleId, {
      sync_status: 'SYNCED',
      synced_at: opts.ackedAtIso,
      server_result: result ?? existing.server_result,
      ...(reassignedNo && reassignedNo !== existing.invoice_no
        ? { invoice_no: reassignedNo }
        : {}),
    })
    return
  }

  if (cmd.type === 'VoidSale') {
    const payloadObj =
      cmd.payload && typeof cmd.payload === 'object'
        ? ((cmd.payload as Record<string, unknown>).void as Record<string, unknown> | undefined)
        : undefined
    const saleId =
      payloadObj && typeof payloadObj.sale_id === 'string' ? payloadObj.sale_id : null
    if (!saleId) return
    const existing = await saleTable.get(saleId)
    if (!existing) return
    await saleTable.update(saleId, {
      sync_status: 'SYNCED',
      synced_at: opts.ackedAtIso,
      ...(result ? { server_result: result } : {}),
    })
    return
  }

  if (cmd.type === 'FinalizeCreditNote') {
    const cnId = extractPayloadId(cmd, 'credit_note')
    if (!cnId) return
    const existing = await cnTable.get(cnId)
    if (!existing) return
    await cnTable.update(cnId, {
      sync_status: 'SYNCED',
    })
    return
  }

  if (cmd.type === 'OpenShift') {
    const shiftId = extractPayloadId(cmd, 'shift')
    if (!shiftId) return
    const existing = await shiftTable.get(shiftId)
    if (!existing) return
    await shiftTable.update(shiftId, {
      sync_status: 'SYNCED',
    })
    return
  }

  if (cmd.type === 'CloseShift') {
    const payloadObj =
      cmd.payload && typeof cmd.payload === 'object'
        ? ((cmd.payload as Record<string, unknown>).close as Record<string, unknown> | undefined)
        : undefined
    const shiftId =
      payloadObj && typeof payloadObj.shift_id === 'string' ? payloadObj.shift_id : null
    if (!shiftId) return
    const existing = await shiftTable.get(shiftId)
    if (!existing) return
    await shiftTable.update(shiftId, {
      sync_status: 'SYNCED',
    })
    return
  }

  if (cmd.type === 'RecordCashMovement') {
    const movId = extractPayloadId(cmd, 'movement')
    if (!movId) return
    const existing = await cashTable.get(movId)
    if (!existing) return
    await cashTable.update(movId, {
      sync_status: 'SYNCED',
    })
  }
}
