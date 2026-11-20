import { liveQuery, type Observable } from 'dexie'
import { OpenShiftPayloadV1 } from '~/lib/contracts'
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
