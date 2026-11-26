import {
  AppendAuditPayloadV1,
  CloseShiftPayloadV1,
} from '~/lib/contracts'
import {
  toMoney,
  type Money,
} from '~/lib/kernel'
import { runtimeIdGenerator as defaultIdGen } from '~/lib/runtime-id'
import { cashVariance } from '~/lib/sales-calc'
import { listCashMovementsForShift } from '../../data/cash-movement.repo'
import { listCreditNoteRefundsForShift } from '../../data/credit-note.repo'
import { getMeta, setMeta } from '../../data/meta.repo'
import { listSalePaymentsForShift, listSalesForShift } from '../../data/sale.repo'
import {
  commitCloseShiftTransaction,
  getOpenShiftForRegister,
  listUnackedOutboxCommandIdsForShift,
  ShiftCountLockedError,
} from '../../data/shift.repo'
import type { SolvaDb } from '../../db/solva-db'
import type { ShiftRecord } from '../../db/types'
import {
  computeLocalShiftRecap,
  type LocalShiftRecap,
} from '../../domain/local-shift-recap'
import { withResourceLock } from '../../locks/resource-lock'
import { trustedNowMs } from '../../session/device-state'
import { kickActiveSync } from '../../sync'

export type CloseShiftErrorCode =
  | 'DEVICE_NOT_PAIRED'
  | 'SHIFT_NOT_OPEN'
  | 'INVALID_AMOUNT'
  | 'COUNT_LOCKED'

export class CloseShiftError extends Error {
  readonly code: CloseShiftErrorCode

  constructor(code: CloseShiftErrorCode, message: string) {
    super(message)
    this.name = 'CloseShiftError'
    this.code = code
  }
}

export interface CloseShiftResult {
  shift: ShiftRecord
  recap: LocalShiftRecap
  expectedCash: Money
  variance: Money
}

export async function closeShift(
  db: SolvaDb,
  input: {
    countedCash: number
    staffId: string
    closeNote?: string | null
  },
  deps: { nowMs?: () => number; newId?: () => string } = {},
): Promise<CloseShiftResult> {
  if (!Number.isSafeInteger(input.countedCash) || input.countedCash < 0) {
    throw new CloseShiftError('INVALID_AMOUNT', 'Counted cash must be integer >= 0')
  }

  const device = await getMeta(db, 'device')
  if (!device) {
    throw new CloseShiftError('DEVICE_NOT_PAIRED', 'Device is not paired')
  }

  return withResourceLock({
    tenantId: device.tenant_id,
    deviceId: device.device_id,
    name: `shift:${device.register_id}`,
    fn: async () => {
      const shift = await getOpenShiftForRegister(db, device.register_id)
      if (!shift) {
        throw new CloseShiftError('SHIFT_NOT_OPEN', 'No open shift on this register')
      }
      if (shift.count_submitted_at) {
        throw new CloseShiftError('COUNT_LOCKED', 'Physical cash count is already locked')
      }

      const [clock, sales, salePayments, cashMovements, creditNoteRefunds] =
        await Promise.all([
          getMeta(db, 'clock'),
          listSalesForShift(db, shift.id),
          listSalePaymentsForShift(db, shift.id),
          listCashMovementsForShift(db, shift.id),
          listCreditNoteRefundsForShift(db, shift.id),
        ])

      const recap = computeLocalShiftRecap({
        shift,
        sales,
        salePayments,
        cashMovements,
        creditNoteRefunds,
      })

      const variance = cashVariance(toMoney(input.countedCash), recap.expectedCash)
      const nowMs = (deps.nowMs ?? Date.now)()
      const offsetMs = clock?.offset_ms ?? 0
      const maxSeenMs = clock ? Date.parse(clock.max_seen_time) || 0 : 0
      const correctedMs = trustedNowMs({ nowMs, clockOffsetMs: offsetMs, maxSeenMs })
      const closedAt = new Date(correctedMs).toISOString()
      const closedAtDevice = new Date(nowMs).toISOString()

      const dependsOnIds = await listUnackedOutboxCommandIdsForShift(
        db,
        shift.id,
        sales.map((s) => s.id),
      )

      const newId = deps.newId ?? (() => defaultIdGen.newId())
      const commandId = newId()
      const cleanNote = input.closeNote?.trim() || null

      const payload = CloseShiftPayloadV1.parse({
        shift_id: shift.id,
        counted_cash: input.countedCash,
        count_submitted_at: closedAt,
        closed_at: closedAt,
        closed_at_device: closedAtDevice,
        expected_cash_device: recap.expectedCash,
        variance_device: variance,
        close_note: cleanNote,
      })

      let varianceAudit: { id: string; payload: AppendAuditPayloadV1 } | null = null
      if (variance !== 0) {
        const auditId = newId()
        varianceAudit = {
          id: auditId,
          payload: AppendAuditPayloadV1.parse({
            entry: {
              id: auditId,
              action: 'shift.variance',
              entity_type: 'shift',
              entity_id: shift.id,
              before_data: { expected_cash: recap.expectedCash },
              after_data: { counted_cash: input.countedCash, variance },
              reason_code: 'CASH_VARIANCE',
              reason_text: cleanNote,
              actor_user_id: input.staffId,
              approver_user_id: null,
              occurred_at_device: closedAtDevice,
              occurred_at: closedAt,
              business_date: shift.business_date,
              related_command_id: commandId,
            },
          }),
        }
      }

      try {
        const closedShift = await commitCloseShiftTransaction(db, {
          shiftId: shift.id,
          registerId: device.register_id,
          countedCash: input.countedCash,
          expectedCashDevice: recap.expectedCash,
          varianceDevice: variance,
          countSubmittedAt: closedAt,
          closedAt,
          closedAtDevice,
          closeNote: cleanNote,
          commandId,
          payload,
          varianceAudit,
          dependsOnIds,
        })

        if (clock && correctedMs > maxSeenMs) {
          await setMeta(db, 'clock', { ...clock, max_seen_time: closedAt })
        }

        kickActiveSync('manual')
        return {
          shift: closedShift,
          recap,
          expectedCash: recap.expectedCash,
          variance,
        }
      } catch (err) {
        if (err instanceof ShiftCountLockedError) {
          throw new CloseShiftError('COUNT_LOCKED', err.message)
        }
        throw err
      }
    },
  })
}
