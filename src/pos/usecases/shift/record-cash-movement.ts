import {
  AppendAuditPayloadV1,
  RecordCashMovementPayloadV1,
} from '~/lib/contracts'
import { businessDate, type OutletTimezone } from '~/lib/kernel'
import { runtimeIdGenerator as defaultIdGen } from '~/lib/runtime-id'
import { commitCashMovementTransaction } from '../../data/cash-movement.repo'
import { getOutlet } from '../../data/master.repo'
import { getMeta } from '../../data/meta.repo'
import { getUnackedOpenShiftCommandId } from '../../data/sale.repo'
import { getOpenShiftForRegister } from '../../data/shift.repo'
import type { SolvaDb } from '../../db/solva-db'
import type { CashMovementRecord } from '../../db/types'
import { withResourceLock } from '../../locks/resource-lock'
import { trustedNowMs } from '../../session/device-state'
import { kickActiveSync } from '../../sync'

export type RecordCashMovementErrorCode =
  | 'DEVICE_NOT_PAIRED'
  | 'SHIFT_REQUIRED'
  | 'INVALID_AMOUNT'
  | 'REASON_REQUIRED'

export class RecordCashMovementError extends Error {
  readonly code: RecordCashMovementErrorCode

  constructor(code: RecordCashMovementErrorCode, message: string) {
    super(message)
    this.name = 'RecordCashMovementError'
    this.code = code
  }
}

export async function recordCashMovement(
  db: SolvaDb,
  input: {
    direction: 'IN' | 'OUT'
    amount: number
    reasonCode: string
    reasonText: string
    staffId: string
  },
  deps: { nowMs?: () => number; newId?: () => string } = {},
): Promise<CashMovementRecord> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new RecordCashMovementError('INVALID_AMOUNT', 'Cash movement amount must be > 0')
  }
  const cleanReason = input.reasonText.trim()
  if (!cleanReason || !input.reasonCode.trim()) {
    throw new RecordCashMovementError('REASON_REQUIRED', 'Cash movement reason is required')
  }

  const device = await getMeta(db, 'device')
  if (!device) {
    throw new RecordCashMovementError('DEVICE_NOT_PAIRED', 'Device is not paired')
  }

  return withResourceLock({
    tenantId: device.tenant_id,
    deviceId: device.device_id,
    name: `shift:${device.register_id}`,
    fn: async () => {
      const shift = await getOpenShiftForRegister(db, device.register_id)
      if (!shift) {
        throw new RecordCashMovementError('SHIFT_REQUIRED', 'Open shift is required')
      }

      const [clock, outlet, openShiftCmdId] = await Promise.all([
        getMeta(db, 'clock'),
        getOutlet(db, device.outlet_id),
        getUnackedOpenShiftCommandId(db, shift),
      ])

      const nowMs = (deps.nowMs ?? Date.now)()
      const offsetMs = clock?.offset_ms ?? 0
      const maxSeenMs = clock ? Date.parse(clock.max_seen_time) || 0 : 0
      const occurredAt = new Date(
        trustedNowMs({ nowMs, clockOffsetMs: offsetMs, maxSeenMs }),
      ).toISOString()
      const createdAtDevice = new Date(nowMs).toISOString()
      const bDate = outlet
        ? businessDate(
            occurredAt,
            outlet.timezone as OutletTimezone,
            outlet.day_cutoff_time,
          )
        : shift.business_date

      const newId = deps.newId ?? (() => defaultIdGen.newId())
      const movementId = newId()
      const auditId = newId()

      const payload = RecordCashMovementPayloadV1.parse({
        movement: {
          id: movementId,
          shift_id: shift.id,
          created_by: input.staffId,
          created_at_device: createdAtDevice,
          clock_offset_ms: offsetMs,
          occurred_at: occurredAt,
          business_date: bDate,
          direction: input.direction,
          amount: input.amount,
          reason_code: input.reasonCode.trim(),
          reason_text: cleanReason,
        },
      })

      const auditPayload = AppendAuditPayloadV1.parse({
        entry: {
          id: auditId,
          action: 'cash.movement',
          entity_type: 'cash_movement',
          entity_id: movementId,
          before_data: null,
          after_data: { direction: input.direction, amount: input.amount },
          reason_code: input.reasonCode.trim(),
          reason_text: cleanReason,
          actor_user_id: input.staffId,
          approver_user_id: null,
          occurred_at_device: createdAtDevice,
          occurred_at: occurredAt,
          business_date: bDate,
          related_command_id: movementId,
        },
      })

      const record: CashMovementRecord = {
        id: movementId,
        tenant_id: device.tenant_id,
        outlet_id: device.outlet_id,
        register_id: device.register_id,
        device_id: device.device_id,
        shift_id: shift.id,
        created_by: input.staffId,
        created_at_device: createdAtDevice,
        clock_offset_ms: offsetMs,
        occurred_at: occurredAt,
        business_date: bDate,
        direction: input.direction,
        amount: input.amount,
        reason_code: input.reasonCode.trim(),
        reason_text: cleanReason,
        sync_status: 'PENDING',
      }

      const committed = await commitCashMovementTransaction(db, {
        movement: record,
        commandId: movementId,
        payload,
        auditCommandId: auditId,
        auditPayload,
        registerId: device.register_id,
        createdAtDevice,
        dependsOnOpenShiftId: openShiftCmdId,
      })

      kickActiveSync('manual')
      return committed
    },
  })
}
