import type { OpenShiftPayloadV1 } from '~/lib/contracts'
import { businessDate, createIdGenerator, type OutletTimezone } from '~/lib/kernel'
import type { SolvaDb } from '../../db/solva-db'
import type { OutboxCommandRow, ShiftRecord } from '../../db/types'
import { getOutlet } from '../../data/master.repo'
import { getMeta } from '../../data/meta.repo'
import {
  getOpenShiftForRegister,
  insertShiftAndOpenCommand,
  ShiftAlreadyOpenError,
} from '../../data/shift.repo'
import { trustedNowMs } from '../../session/device-state'

export interface OpenShiftInput {
  openingCash: number
  staffId: string
}

export interface OpenShiftDeps {
  nowMs?: () => number
  newId?: () => string
}

export type OpenShiftResult =
  | { readonly ok: true; readonly shift: ShiftRecord; readonly command: OutboxCommandRow }
  | {
      readonly ok: false
      readonly reason:
        | 'INVALID_AMOUNT'
        | 'SHIFT_ALREADY_OPEN'
        | 'DEVICE_NOT_PAIRED'
        | 'OUTLET_NOT_FOUND'
      readonly existingShift?: ShiftRecord
    }

const defaultIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})

/**
 * Opens a register shift offline in a single Dexie transaction (shift row + OpenShift outbox
 * command). Never hits the network and enforces at most 1 OPEN shift per register.
 */
export async function openShift(
  db: SolvaDb,
  input: OpenShiftInput,
  deps: OpenShiftDeps = {},
): Promise<OpenShiftResult> {
  if (!Number.isSafeInteger(input.openingCash) || input.openingCash < 0) {
    return { ok: false, reason: 'INVALID_AMOUNT' }
  }

  const device = await getMeta(db, 'device')
  if (!device) {
    return { ok: false, reason: 'DEVICE_NOT_PAIRED' }
  }

  const existing = await getOpenShiftForRegister(db, device.register_id)
  if (existing) {
    return { ok: false, reason: 'SHIFT_ALREADY_OPEN', existingShift: existing }
  }

  const outlet = await getOutlet(db, device.outlet_id)
  if (!outlet) {
    return { ok: false, reason: 'OUTLET_NOT_FOUND' }
  }

  const clock = await getMeta(db, 'clock')
  const nowMs = (deps.nowMs ?? Date.now)()
  const offsetMs = clock?.offset_ms ?? 0
  const maxSeenMs = clock ? Date.parse(clock.max_seen_time) || 0 : 0
  const correctedMs = trustedNowMs({ nowMs, clockOffsetMs: offsetMs, maxSeenMs })

  const createdAtDevice = new Date(nowMs).toISOString()
  const occurredAt = new Date(correctedMs).toISOString()
  const bDate = businessDate(occurredAt, outlet.timezone as OutletTimezone, outlet.day_cutoff_time)

  const newId = deps.newId ?? (() => defaultIdGen.newId())
  const shiftId = newId()
  const commandId = newId()

  const shift: ShiftRecord = {
    id: shiftId,
    tenant_id: device.tenant_id,
    outlet_id: device.outlet_id,
    register_id: device.register_id,
    device_id: device.device_id,
    status: 'OPEN',
    opening_cash: input.openingCash,
    opened_by: input.staffId,
    open_command_id: commandId,
    created_at_device: createdAtDevice,
    occurred_at: occurredAt,
    business_date: bDate,
    closed_at: null,
    counted_cash: null,
    sync_status: 'PENDING',
  }

  const payload: OpenShiftPayloadV1 = {
    shift: {
      id: shiftId,
      created_by: input.staffId,
      created_at_device: createdAtDevice,
      clock_offset_ms: offsetMs,
      occurred_at: occurredAt,
      business_date: bDate,
      opening_cash: input.openingCash,
    },
  }

  try {
    const res = await insertShiftAndOpenCommand(db, {
      shift,
      commandId,
      createdAtDevice,
      payload,
    })
    return { ok: true, shift: res.shift, command: res.command }
  } catch (err) {
    if (err instanceof ShiftAlreadyOpenError) {
      return { ok: false, reason: 'SHIFT_ALREADY_OPEN', existingShift: err.existingShift }
    }
    throw err
  }
}
