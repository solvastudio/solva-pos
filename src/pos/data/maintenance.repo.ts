import Dexie, { type Table } from 'dexie'
import { MAX_DEVICE_LOG_ROWS } from './device-log.repo'
import { getMeta } from './meta.repo'
import type { SolvaDb } from '../db/solva-db'
import type { OutboxCommandRow } from '../db/types'

function isSyncedStatus(syncStatus: unknown): boolean {
  return syncStatus === 'SYNCED' || syncStatus === 'ACKED'
}

export interface RetentionChunkSummary {
  readonly salesDeleted: number
  readonly creditNotesDeleted: number
  readonly cashMovementsDeleted: number
  readonly shiftsDeleted: number
  readonly outboxPayloadsStripped: number
  readonly printJobsDeleted: number
  readonly deviceLogsTrimmed: number
  readonly pullStageDeleted: number
  readonly cartDraftsDeleted: number
}

/**
 * Deletes one chunk (`<= chunkSize`) of expired SYNCED records and their children atomically,
 * strips aged ACKED outbox payloads, and cleans disposable logs/stages/drafts.
 */
export async function executeRetentionChunk(
  db: SolvaDb,
  opts: {
    cutoffDate: string
    outboxCutoffIso: string
    printCutoffIso: string
    chunkSize: number
  },
): Promise<RetentionChunkSummary> {
  const { cutoffDate, outboxCutoffIso, printCutoffIso, chunkSize } = opts

  let salesDeleted = 0
  let creditNotesDeleted = 0
  let cashMovementsDeleted = 0
  let shiftsDeleted = 0
  let outboxPayloadsStripped = 0
  let printJobsDeleted = 0
  let deviceLogsTrimmed = 0
  let pullStageDeleted = 0
  let cartDraftsDeleted = 0

  const eligibleSales = await db.sale
    .where('[sync_status+business_date]')
    .between(['SYNCED', Dexie.minKey], ['SYNCED', cutoffDate], true, false)
    .limit(chunkSize)
    .toArray()

  if (eligibleSales.length > 0) {
    const saleIds = eligibleSales.map((s) => s.id)
    await db.transaction(
      'rw',
      [db.sale, db.sale_line, db.sale_line_modifier, db.sale_payment],
      async () => {
        const lineIds: string[] = []
        for (const sid of saleIds) {
          const lines = await db.sale_line.where('sale_id').equals(sid).primaryKeys()
          lineIds.push(...lines)
          await db.sale_line.where('sale_id').equals(sid).delete()
          await db.sale_payment.where('sale_id').equals(sid).delete()
        }
        if (lineIds.length > 0) {
          await db.sale_line_modifier.where('sale_line_id').anyOf(lineIds).delete()
        }
        await db.sale.bulkDelete(saleIds)
      },
    )
    salesDeleted = saleIds.length
  }

  const eligibleCns = await db.credit_note
    .where('[sync_status+business_date]')
    .between(['SYNCED', Dexie.minKey], ['SYNCED', cutoffDate], true, false)
    .limit(chunkSize)
    .toArray()

  if (eligibleCns.length > 0) {
    const cnIds = eligibleCns.map((c) => c.id)
    await db.transaction(
      'rw',
      [db.credit_note, db.credit_note_line, db.credit_note_refund],
      async () => {
        for (const cid of cnIds) {
          await db.credit_note_line.where('credit_note_id').equals(cid).delete()
          await db.credit_note_refund.where('credit_note_id').equals(cid).delete()
        }
        await db.credit_note.bulkDelete(cnIds)
      },
    )
    creditNotesDeleted = cnIds.length
  }

  const eligibleCashIds = await db.cash_movement
    .filter((row) => isSyncedStatus(row.sync_status) && row.business_date < cutoffDate)
    .limit(chunkSize)
    .primaryKeys()

  if (eligibleCashIds.length > 0) {
    await db.cash_movement.bulkDelete(eligibleCashIds)
    cashMovementsDeleted = eligibleCashIds.length
  }

  const eligibleShifts = await db.shift
    .where('[sync_status+business_date]')
    .between(['SYNCED', Dexie.minKey], ['SYNCED', cutoffDate], true, false)
    .filter((s) => s.status !== 'OPEN')
    .limit(chunkSize)
    .primaryKeys()

  if (eligibleShifts.length > 0) {
    await db.shift.bulkDelete(eligibleShifts)
    shiftsDeleted = eligibleShifts.length
  }

  const ackedOutbox = await db.outbox_command
    .where('[status+device_seq]')
    .between(['ACKED', Dexie.minKey], ['ACKED', Dexie.maxKey])
    .filter((row) => {
      if (row.payload === null || row.payload === undefined) return false
      const refIso = row.acked_at ?? row.created_at_device
      return refIso < outboxCutoffIso
    })
    .limit(chunkSize)
    .toArray()

  if (ackedOutbox.length > 0) {
    await db.transaction('rw', db.outbox_command, async () => {
      for (const row of ackedOutbox) {
        await db.outbox_command.update(row.id, { payload: null })
      }
    })
    outboxPayloadsStripped = ackedOutbox.length
  }

  const oldPrintJobIds = await db.print_job
    .where('[status+created_at]')
    .between(['DONE', Dexie.minKey], ['DONE', printCutoffIso], true, false)
    .limit(chunkSize)
    .primaryKeys()

  if (oldPrintJobIds.length > 0) {
    await db.print_job.bulkDelete(oldPrintJobIds)
    printJobsDeleted = oldPrintJobIds.length
  }

  const logCount = await db.device_log.count()
  if (logCount > MAX_DEVICE_LOG_ROWS) {
    const excess = Math.min(chunkSize, logCount - MAX_DEVICE_LOG_ROWS)
    const oldestLogIds = await db.device_log.orderBy(':id').limit(excess).primaryKeys()
    if (oldestLogIds.length > 0) {
      await db.device_log.bulkDelete(oldestLogIds)
      deviceLogsTrimmed = oldestLogIds.length
    }
  }

  const stageMeta = await getMeta(db, 'stage')
  const activeCycleId = stageMeta?.cycle_id ?? null
  const stalePullIds = await db.pull_stage
    .filter((row) => row.cycle_id !== activeCycleId)
    .limit(chunkSize)
    .primaryKeys()

  if (stalePullIds.length > 0) {
    await db.pull_stage.bulkDelete(stalePullIds)
    pullStageDeleted = stalePullIds.length
  }

  const usedDraftIds = await db.cart_draft
    .where('status')
    .equals('USED')
    .limit(chunkSize)
    .primaryKeys()

  if (usedDraftIds.length > 0) {
    await db.cart_draft.bulkDelete(usedDraftIds)
    cartDraftsDeleted = usedDraftIds.length
  }

  return {
    salesDeleted,
    creditNotesDeleted,
    cashMovementsDeleted,
    shiftsDeleted,
    outboxPayloadsStripped,
    printJobsDeleted,
    deviceLogsTrimmed,
    pullStageDeleted,
    cartDraftsDeleted,
  }
}

export interface DynamicRawPendingSnapshot {
  readonly rows: OutboxCommandRow[]
  readonly deviceId: string
  readonly registerId: string
  readonly offsetMs: number
}

/**
 * Dynamic-mode Dexie recovery reader (ARCH §3.2): opens IndexedDB without schema
 * declarations so pending outbox entries can be read even if schema upgrade fails.
 */
export async function readPendingOutboxDynamic(
  dbName: string,
): Promise<DynamicRawPendingSnapshot | null> {
  const rawDb = new Dexie(dbName)
  try {
    await rawDb.open()
    const tableNames = rawDb.tables.map((t) => t.name)
    if (!tableNames.includes('outbox_command')) {
      return null
    }
    const outboxTable = rawDb.table('outbox_command') as Table<OutboxCommandRow, string>
    const allRows = await outboxTable.toArray()
    let deviceId = 'recovery-device'
    let registerId = 'unknown-register'
    let offsetMs = 0
    if (tableNames.includes('meta')) {
      const metaRows = (await rawDb.table('meta').toArray()) as Array<{
        key: string
        value: Record<string, unknown>
      }>
      const dev = metaRows.find((m) => m.key === 'device')?.value
      const clk = metaRows.find((m) => m.key === 'clock')?.value
      if (dev && typeof dev.device_id === 'string') deviceId = dev.device_id
      if (dev && typeof dev.register_id === 'string') registerId = dev.register_id
      if (clk && typeof clk.offset_ms === 'number') offsetMs = clk.offset_ms
    }

    return {
      rows: allRows.filter((row) => row.status !== 'ACKED' && row.status !== 'DISMISSED'),
      deviceId,
      registerId,
      offsetMs,
    }
  } catch {
    return null
  } finally {
    rawDb.close()
  }
}
