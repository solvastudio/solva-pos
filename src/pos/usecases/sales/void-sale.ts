import {
  AppendAuditPayloadV1,
  VoidSalePayloadV1,
} from '~/lib/contracts'
import { businessDate, createIdGenerator, type OutletTimezone } from '~/lib/kernel'
import { getOutlet } from '../../data/master.repo'
import { getMeta } from '../../data/meta.repo'
import {
  commitVoidSaleTransaction,
  getSaleById,
  getUnackedFinalizeSaleCommandId,
} from '../../data/sale.repo'
import { getOpenShiftForRegister } from '../../data/shift.repo'
import type { SolvaDb } from '../../db/solva-db'
import type { SaleRecord } from '../../db/types'
import { withResourceLock } from '../../locks/resource-lock'
import { trustedNowMs } from '../../session/device-state'
import { kickActiveSync } from '../../sync'

export type VoidSaleErrorCode =
  | 'DEVICE_NOT_PAIRED'
  | 'SALE_NOT_FOUND'
  | 'OTHER_REGISTER_FORBIDDEN'
  | 'ALREADY_VOIDED'
  | 'SHIFT_CLOSED'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'REASON_REQUIRED'

export class VoidSaleError extends Error {
  readonly code: VoidSaleErrorCode

  constructor(code: VoidSaleErrorCode, message: string) {
    super(message)
    this.name = 'VoidSaleError'
    this.code = code
  }
}

export interface VoidSaleInput {
  saleId: string
  requesterId: string
  approverId: string
  reasonCode: string
  reasonText: string
}

export interface VoidSaleDeps {
  nowMs?: () => number
  newId?: () => string
}

const defaultIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})

export async function voidSale(
  db: SolvaDb,
  input: VoidSaleInput,
  deps: VoidSaleDeps = {},
): Promise<SaleRecord> {
  if (input.approverId === input.requesterId) {
    throw new VoidSaleError(
      'SELF_APPROVAL_FORBIDDEN',
      'Supervisor approving void must differ from requester',
    )
  }
  const cleanReason = input.reasonText.trim()
  if (!cleanReason || !input.reasonCode.trim()) {
    throw new VoidSaleError('REASON_REQUIRED', 'Void reason is required')
  }

  const device = await getMeta(db, 'device')
  if (!device) {
    throw new VoidSaleError('DEVICE_NOT_PAIRED', 'Device is not paired')
  }

  return withResourceLock({
    tenantId: device.tenant_id,
    deviceId: device.device_id,
    name: `finalize:${device.register_id}`,
    fn: async () => {
      const sale = await getSaleById(db, input.saleId)
      if (!sale) {
        throw new VoidSaleError('SALE_NOT_FOUND', 'Sale not found on device')
      }
      if (sale.register_id !== device.register_id) {
        throw new VoidSaleError(
          'OTHER_REGISTER_FORBIDDEN',
          'Void is allowed only on the originating register',
        )
      }
      if (sale.status === 'VOID') {
        throw new VoidSaleError('ALREADY_VOIDED', 'Sale has already been voided')
      }

      const openShift = await getOpenShiftForRegister(db, device.register_id)
      if (!openShift || openShift.id !== sale.shift_id) {
        throw new VoidSaleError(
          'SHIFT_CLOSED',
          'After shift closes, corrections must use return/credit note',
        )
      }

      const [clock, outlet, finalizeCmdId] = await Promise.all([
        getMeta(db, 'clock'),
        getOutlet(db, device.outlet_id),
        getUnackedFinalizeSaleCommandId(db, sale.id),
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
        : openShift.business_date

      const newId = deps.newId ?? (() => defaultIdGen.newId())
      const commandId = newId()
      const auditCommandId = newId()

      const payload = VoidSalePayloadV1.parse({
        sale_id: sale.id,
        voided_at: occurredAt,
        voided_by: input.requesterId,
        void_approved_by: input.approverId,
        reason_code: input.reasonCode.trim(),
        reason_text: cleanReason,
      })

      const auditPayload = AppendAuditPayloadV1.parse({
        entry: {
          id: auditCommandId,
          action: 'sale.void',
          entity_type: 'sale',
          entity_id: sale.id,
          before_data: { status: 'PAID', grand_total: sale.grand_total },
          after_data: { status: 'VOID' },
          reason_code: input.reasonCode.trim(),
          reason_text: cleanReason,
          actor_user_id: input.requesterId,
          approver_user_id: input.approverId,
          occurred_at_device: createdAtDevice,
          occurred_at: occurredAt,
          business_date: bDate,
          related_command_id: commandId,
        },
      })

      const updated = await commitVoidSaleTransaction(db, {
        saleId: sale.id,
        registerId: device.register_id,
        voidPatch: {
          voided_at: occurredAt,
          voided_by: input.requesterId,
          void_approved_by: input.approverId,
          void_reason_code: input.reasonCode.trim(),
          void_reason_text: cleanReason,
        },
        commandId,
        payload,
        auditCommandId,
        auditPayload,
        dependsOnFinalizeSaleId: finalizeCmdId,
        createdAtDevice,
      })

      kickActiveSync('manual')
      return updated
    },
  })
}
