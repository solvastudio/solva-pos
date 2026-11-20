import { liveQuery, type Observable } from 'dexie'
import {
  SCHEMA_VERSION,
  type AppendAuditPayloadV1,
  type RecordCashMovementPayloadV1,
} from '~/lib/contracts'
import type { SolvaDb } from '../db/solva-db'
import type { CashMovementRecord } from '../db/types'
import { enqueueCommand } from './outbox.repo'

export async function listCashMovementsForShift(
  db: SolvaDb,
  shiftId: string,
): Promise<CashMovementRecord[]> {
  const rows = await db.cash_movement.where('shift_id').equals(shiftId).toArray()
  return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
}

export function observeCashMovementsForShift(
  db: SolvaDb,
  shiftId: string,
): Observable<CashMovementRecord[]> {
  return liveQuery(() => listCashMovementsForShift(db, shiftId))
}

export async function commitCashMovementTransaction(
  db: SolvaDb,
  input: {
    movement: CashMovementRecord
    commandId: string
    payload: RecordCashMovementPayloadV1
    auditCommandId: string
    auditPayload: AppendAuditPayloadV1
    registerId: string
    createdAtDevice: string
    dependsOnOpenShiftId: string | null
  },
): Promise<CashMovementRecord> {
  return db.transaction(
    'rw',
    [db.cash_movement, db.outbox_command, db.local_counter],
    async (tx) => {
      await tx.table<CashMovementRecord, string>('cash_movement').add(input.movement)

      await enqueueCommand(tx, {
        id: input.commandId,
        type: 'RecordCashMovement',
        payload: input.payload,
        schemaVersion: SCHEMA_VERSION,
        registerId: input.registerId,
        dependencyKey: `shift:${input.movement.shift_id}`,
        dependsOn: input.dependsOnOpenShiftId ? [input.dependsOnOpenShiftId] : [],
        createdAtDevice: input.createdAtDevice,
      })

      await enqueueCommand(tx, {
        id: input.auditCommandId,
        type: 'AppendAudit',
        payload: input.auditPayload,
        schemaVersion: SCHEMA_VERSION,
        registerId: input.registerId,
        dependencyKey: `audit:${input.movement.id}`,
        dependsOn: [input.commandId],
        createdAtDevice: input.createdAtDevice,
      })

      return input.movement
    },
  )
}
