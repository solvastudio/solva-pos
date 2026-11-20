import { liveQuery, type Observable } from 'dexie'
import {
  CloseShiftPayloadV1,
  OpenShiftPayloadV1,
  SCHEMA_VERSION,
  type AppendAuditPayloadV1,
} from '~/lib/contracts'
import type { SolvaDb } from '../db/solva-db'
import type { OutboxCommandRow, ShiftRecord } from '../db/types'
import { enqueueCommand } from './outbox.repo'

export class ShiftAlreadyOpenError extends Error {
  readonly existingShift: ShiftRecord

  constructor(existingShift: ShiftRecord) {
    super(`Register ${existingShift.register_id} already has open shift ${existingShift.id}`)
    this.name = 'ShiftAlreadyOpenError'
    this.existingShift = existingShift
  }
}

export async function getOpenShiftForRegister(
  db: SolvaDb,
  registerId: string,
): Promise<ShiftRecord | null> {
  const row = await db.shift
    .where('register_id')
    .equals(registerId)
    .filter((s) => s.status === 'OPEN')
    .first()
  return row ?? null
}

export function observeOpenShiftForRegister(
  db: SolvaDb,
  registerId: string,
): Observable<ShiftRecord | null> {
  return liveQuery(() => getOpenShiftForRegister(db, registerId))
}

export async function insertShiftAndOpenCommand(
  db: SolvaDb,
  input: {
    shift: ShiftRecord
    commandId: string
    createdAtDevice: string
    payload: OpenShiftPayloadV1
  },
): Promise<{ shift: ShiftRecord; command: OutboxCommandRow }> {
  const validPayload = OpenShiftPayloadV1.parse(input.payload)

  return db.transaction('rw', [db.shift, db.outbox_command, db.local_counter], async (tx) => {
    const existing = await tx
      .table<ShiftRecord, string>('shift')
      .where('register_id')
      .equals(input.shift.register_id)
      .filter((s) => s.status === 'OPEN')
      .first()
    if (existing) {
      throw new ShiftAlreadyOpenError(existing)
    }

    await tx.table<ShiftRecord, string>('shift').add(input.shift)
    const command = await enqueueCommand(tx, {
      id: input.commandId,
      type: 'OpenShift',
      payload: validPayload,
      schemaVersion: 1,
      registerId: input.shift.register_id,
      dependencyKey: `shift:${input.shift.id}`,
      dependsOn: [],
      createdAtDevice: input.createdAtDevice,
    })

    return { shift: input.shift, command }
  })
}

export class ShiftCountLockedError extends Error {
  constructor(shiftId: string) {
    super(`Shift ${shiftId} is already closed/locked`)
    this.name = 'ShiftCountLockedError'
  }
}

export async function getLatestClosedShiftForRegister(
  db: SolvaDb,
  registerId: string,
): Promise<ShiftRecord | null> {
  const rows = await db.shift
    .where('register_id')
    .equals(registerId)
    .filter((s) => s.status === 'CLOSED' || s.status === 'FORCE_CLOSED')
    .toArray()
  rows.sort((a, b) => (b.closed_at ?? b.occurred_at).localeCompare(a.closed_at ?? a.occurred_at))
  return rows[0] ?? null
}

export async function listUnackedOutboxCommandIdsForShift(
  db: SolvaDb,
  shiftId: string,
  saleIds: readonly string[],
): Promise<string[]> {
  const all = await db.outbox_command.toArray()
  const saleKeySet = new Set(saleIds.map((id) => `sale:${id}`))
  const ids: string[] = []
  for (const cmd of all) {
    if (cmd.status === 'ACKED') continue
    if (cmd.dependency_key === `shift:${shiftId}` || (cmd.dependency_key && saleKeySet.has(cmd.dependency_key))) {
      ids.push(cmd.id)
    }
  }
  return ids
}

export async function commitCloseShiftTransaction(
  db: SolvaDb,
  input: {
    shiftId: string
    registerId: string
    countedCash: number
    expectedCashDevice: number
    varianceDevice: number
    countSubmittedAt: string
    closedAt: string
    closedAtDevice: string
    closeNote: string | null
    commandId: string
    payload: CloseShiftPayloadV1
    varianceAudit?: { id: string; payload: AppendAuditPayloadV1 } | null
    dependsOnIds: readonly string[]
  },
): Promise<ShiftRecord> {
  const validPayload = CloseShiftPayloadV1.parse(input.payload)

  return db.transaction('rw', [db.shift, db.outbox_command, db.local_counter], async (tx) => {
    const shiftTable = tx.table<ShiftRecord, string>('shift')
    const current = await shiftTable.get(input.shiftId)
    if (!current || current.status !== 'OPEN' || current.count_submitted_at) {
      throw new ShiftCountLockedError(input.shiftId)
    }

    const updated: ShiftRecord = {
      ...current,
      status: 'CLOSED',
      counted_cash: input.countedCash,
      count_submitted_at: input.countSubmittedAt,
      expected_cash_device: input.expectedCashDevice,
      variance_device: input.varianceDevice,
      closed_at: input.closedAt,
      closed_at_device: input.closedAtDevice,
      close_note: input.closeNote,
      sync_status: 'PENDING',
    }
    await shiftTable.put(updated)

    await enqueueCommand(tx, {
      id: input.commandId,
      type: 'CloseShift',
      payload: validPayload,
      schemaVersion: SCHEMA_VERSION,
      registerId: input.registerId,
      dependencyKey: `shift:${input.shiftId}`,
      dependsOn: [...input.dependsOnIds],
      createdAtDevice: input.closedAtDevice,
    })

    if (input.varianceAudit) {
      await enqueueCommand(tx, {
        id: input.varianceAudit.id,
        type: 'AppendAudit',
        payload: input.varianceAudit.payload,
        schemaVersion: SCHEMA_VERSION,
        registerId: input.registerId,
        dependencyKey: `audit:${input.shiftId}`,
        dependsOn: [input.commandId],
        createdAtDevice: input.closedAtDevice,
      })
    }

    return updated
  })
}
