import '@tanstack/react-start/server-only'
import {
  AcceptBillPayloadV1,
  CancelBillHandoverPayloadV1,
  HandOverBillPayloadV1,
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  type AcceptBillPayloadV1 as AcceptBillInput,
  type CancelBillHandoverPayloadV1 as CancelBillHandoverInput,
  type HandOverBillPayloadV1 as HandOverBillInput,
} from '~/lib/contracts'
import { businessDate, type OutletTimezone } from '~/lib/kernel'
import {
  findMissingAppUserId,
  getOutletBusinessDateConfig,
  getRegisterHandoverTarget,
  isDeviceActiveInTenant,
} from '~/modules/identity/public'
import { executeOnlineCommand, type SyncDeviceIdentity } from '~/modules/sync/public'
import { AppError } from '~/server/error-classify'
import {
  insertBillEvents,
  lockBillForUpdate,
  updateBillHandoverAccepted,
  updateBillHandoverCanceled,
  updateBillHandoverPending,
} from './bill.repo'

export interface HandoverResponse {
  readonly bill_id: string
  readonly bill_seq: number
  readonly status: 'ACK'
  readonly lease_register_id: string
  readonly last_event_seq: number
  readonly server_time: string
}

export interface HandoverRequestMeta {
  readonly requestRef: string
  readonly appVersion: string | null
  readonly nowIso?: string
}

function assertSupportedSchema(schemaVersion: number): void {
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    throw new AppError('UPDATE_REQUIRED', `Unsupported schema_version: ${schemaVersion}`)
  }
}

async function resolveBusinessDate(
  tx: Parameters<typeof getOutletBusinessDateConfig>[0],
  tenantId: string,
  outletId: string,
  nowIso: string,
): Promise<string> {
  const cfg = await getOutletBusinessDateConfig(tx, tenantId, outletId)
  if (!cfg) {
    throw new AppError('VALIDATION_FAILED', 'Outlet configuration not found')
  }
  return businessDate(nowIso, cfg.timezone as OutletTimezone, cfg.dayCutoffTime.slice(0, 5))
}

function wrapOnlineConflict(err: unknown): never {
  if (err instanceof Error && err.name === 'OnlineIdempotencyMismatchError') {
    throw new AppError('VALIDATION_FAILED', err.message)
  }
  throw err
}

/**
 * Online-only voluntary handover initiation (`BILL_HANDED_OVER`, BR-FNB-012, FLOW-19).
 */
export async function handOverBill(
  device: SyncDeviceIdentity,
  rawBody: unknown,
  meta: HandoverRequestMeta,
): Promise<HandoverResponse> {
  const body: HandOverBillInput = HandOverBillPayloadV1.parse(rawBody)
  assertSupportedSchema(body.schema_version)

  try {
    const exec = await executeOnlineCommand(
      {
        device,
        commandId: body.event_id,
        commandType: 'HandOverBill',
        schemaVersion: body.schema_version,
        appVersion: body.app_version ?? meta.appVersion,
        requestRef: meta.requestRef,
        payload: body,
        nowIso: meta.nowIso,
      },
      async (tx, nowIso) => {
        const missingStaff = await findMissingAppUserId(tx, device.tenantId, [body.staff_id])
        if (missingStaff) {
          throw new AppError('VALIDATION_FAILED', `Unknown staff_id ${missingStaff}`)
        }

        const locked = await lockBillForUpdate(tx, device.tenantId, body.bill_id)
        if (!locked) {
          throw new AppError('VALIDATION_FAILED', 'Bill not found')
        }
        if (locked.outletId !== device.outletId || locked.leaseDeviceId !== device.deviceId) {
          throw new AppError('FORBIDDEN', 'Only the current lease holder can hand over this bill')
        }
        if (locked.status !== 'OPEN') {
          throw new AppError('VALIDATION_FAILED', 'Only OPEN bills can be handed over')
        }
        if (locked.handoverStatus !== 'NONE') {
          throw new AppError('HANDOVER_NOT_PENDING', 'Bill already has a pending handover')
        }
        if (body.client_last_event_seq !== locked.lastEventSeq) {
          if (body.client_last_event_seq < locked.lastEventSeq) {
            throw new AppError('EVENTS_PENDING', 'Bill has un-synced or newer events on server')
          }
          throw new AppError('EVENTS_PENDING', 'Client bill events must be synced before handover')
        }

        const target = await getRegisterHandoverTarget(
          tx,
          device.tenantId,
          body.target_register_id,
        )
        if (
          !target ||
          target.outletId !== device.outletId ||
          !target.isActive ||
          target.registerType !== 'CASHIER' ||
          !target.activeDeviceId
        ) {
          throw new AppError('VALIDATION_FAILED', 'fnb.handover.targetInvalid')
        }

        const nextSeq = locked.lastEventSeq + 1
        const bizDate = await resolveBusinessDate(tx, device.tenantId, device.outletId, nowIso)

        await insertBillEvents(tx, [
          {
            id: body.event_id,
            tenantId: device.tenantId,
            outletId: device.outletId,
            billId: locked.id,
            billSeq: nextSeq,
            deviceId: device.deviceId,
            registerId: device.registerId,
            deviceSeq: body.device_seq,
            staffId: body.staff_id,
            eventType: 'BILL_HANDED_OVER',
            payload: { target_register_id: body.target_register_id },
            reasonCode: null,
            reasonText: null,
            originBillId: null,
            originEventIds: null,
            targetRegisterId: body.target_register_id,
            handoverEventId: null,
            createdAtDevice: body.created_at_device,
            clockOffsetMs: body.clock_offset_ms,
            occurredAt: nowIso,
            businessDate: bizDate,
            receivedAt: nowIso,
            commandId: body.event_id,
            schemaVersion: body.schema_version ?? SCHEMA_VERSION,
            appVersion: body.app_version ?? meta.appVersion,
          },
        ])

        await updateBillHandoverPending(tx, {
          tenantId: device.tenantId,
          billId: locked.id,
          targetRegisterId: body.target_register_id,
          handoverEventId: body.event_id,
          nextSeq,
          nowIso,
        })

        return {
          bill_id: locked.id,
          bill_seq: nextSeq,
          status: 'ACK' as const,
          lease_register_id: locked.leaseRegisterId,
          last_event_seq: nextSeq,
        }
      },
    )

    return {
      ...exec.result,
      server_time: exec.serverTime,
    }
  } catch (err) {
    wrapOnlineConflict(err)
  }
}

/**
 * Online-only bill acceptance by an active device on the target CASHIER register (`BILL_ACCEPTED`, BR-FNB-012/013, EC-061).
 */
export async function acceptBill(
  device: SyncDeviceIdentity,
  rawBody: unknown,
  meta: HandoverRequestMeta,
): Promise<HandoverResponse> {
  const body: AcceptBillInput = AcceptBillPayloadV1.parse(rawBody)
  assertSupportedSchema(body.schema_version)

  try {
    const exec = await executeOnlineCommand(
      {
        device,
        commandId: body.event_id,
        commandType: 'AcceptBill',
        schemaVersion: body.schema_version,
        appVersion: body.app_version ?? meta.appVersion,
        requestRef: meta.requestRef,
        payload: body,
        nowIso: meta.nowIso,
      },
      async (tx, nowIso) => {
        const missingStaff = await findMissingAppUserId(tx, device.tenantId, [body.staff_id])
        if (missingStaff) {
          throw new AppError('VALIDATION_FAILED', `Unknown staff_id ${missingStaff}`)
        }

        const locked = await lockBillForUpdate(tx, device.tenantId, body.bill_id)
        if (!locked) {
          throw new AppError('VALIDATION_FAILED', 'Bill not found')
        }
        if (locked.outletId !== device.outletId) {
          throw new AppError('FORBIDDEN', 'Bill belongs to another outlet')
        }
        if (locked.status !== 'OPEN' || locked.handoverStatus !== 'PENDING' || !locked.handoverEventId) {
          throw new AppError('HANDOVER_NOT_PENDING', 'Bill does not have a pending handover')
        }
        if (
          device.registerType !== 'CASHIER' ||
          locked.handoverTargetRegisterId !== device.registerId
        ) {
          throw new AppError('FORBIDDEN', 'Device register is not the handover target')
        }

        const senderActive = await isDeviceActiveInTenant(tx, device.tenantId, locked.leaseDeviceId)
        if (!senderActive) {
          throw new AppError('VALIDATION_FAILED', 'Sender device has been revoked')
        }

        const nextSeq = locked.lastEventSeq + 1
        const bizDate = await resolveBusinessDate(tx, device.tenantId, device.outletId, nowIso)

        await insertBillEvents(tx, [
          {
            id: body.event_id,
            tenantId: device.tenantId,
            outletId: device.outletId,
            billId: locked.id,
            billSeq: nextSeq,
            deviceId: device.deviceId,
            registerId: device.registerId,
            deviceSeq: body.device_seq,
            staffId: body.staff_id,
            eventType: 'BILL_ACCEPTED',
            payload: { handover_event_id: locked.handoverEventId },
            reasonCode: null,
            reasonText: null,
            originBillId: null,
            originEventIds: null,
            targetRegisterId: null,
            handoverEventId: locked.handoverEventId,
            createdAtDevice: body.created_at_device,
            clockOffsetMs: body.clock_offset_ms,
            occurredAt: nowIso,
            businessDate: bizDate,
            receivedAt: nowIso,
            commandId: body.event_id,
            schemaVersion: body.schema_version ?? SCHEMA_VERSION,
            appVersion: body.app_version ?? meta.appVersion,
          },
        ])

        await updateBillHandoverAccepted(tx, {
          tenantId: device.tenantId,
          billId: locked.id,
          leaseDeviceId: device.deviceId,
          leaseRegisterId: device.registerId,
          nextSeq,
          nowIso,
        })

        return {
          bill_id: locked.id,
          bill_seq: nextSeq,
          status: 'ACK' as const,
          lease_register_id: device.registerId,
          last_event_seq: nextSeq,
        }
      },
    )

    return {
      ...exec.result,
      server_time: exec.serverTime,
    }
  } catch (err) {
    wrapOnlineConflict(err)
  }
}

/**
 * Online-only handover cancellation by the current sender lease holder (`BILL_HANDOVER_CANCELED`, BR-FNB-012, EC-061).
 */
export async function cancelBillHandover(
  device: SyncDeviceIdentity,
  rawBody: unknown,
  meta: HandoverRequestMeta,
): Promise<HandoverResponse> {
  const body: CancelBillHandoverInput = CancelBillHandoverPayloadV1.parse(rawBody)
  assertSupportedSchema(body.schema_version)

  try {
    const exec = await executeOnlineCommand(
      {
        device,
        commandId: body.event_id,
        commandType: 'CancelBillHandover',
        schemaVersion: body.schema_version,
        appVersion: body.app_version ?? meta.appVersion,
        requestRef: meta.requestRef,
        payload: body,
        nowIso: meta.nowIso,
      },
      async (tx, nowIso) => {
        const missingStaff = await findMissingAppUserId(tx, device.tenantId, [body.staff_id])
        if (missingStaff) {
          throw new AppError('VALIDATION_FAILED', `Unknown staff_id ${missingStaff}`)
        }

        const locked = await lockBillForUpdate(tx, device.tenantId, body.bill_id)
        if (!locked) {
          throw new AppError('VALIDATION_FAILED', 'Bill not found')
        }
        if (locked.outletId !== device.outletId) {
          throw new AppError('FORBIDDEN', 'Bill belongs to another outlet')
        }
        if (locked.status !== 'OPEN' || locked.handoverStatus !== 'PENDING' || !locked.handoverEventId) {
          throw new AppError('HANDOVER_NOT_PENDING', 'Bill does not have a pending handover')
        }
        if (locked.leaseDeviceId !== device.deviceId) {
          throw new AppError('FORBIDDEN', 'Only the current lease holder can cancel handover')
        }

        const nextSeq = locked.lastEventSeq + 1
        const bizDate = await resolveBusinessDate(tx, device.tenantId, device.outletId, nowIso)

        await insertBillEvents(tx, [
          {
            id: body.event_id,
            tenantId: device.tenantId,
            outletId: device.outletId,
            billId: locked.id,
            billSeq: nextSeq,
            deviceId: device.deviceId,
            registerId: device.registerId,
            deviceSeq: body.device_seq,
            staffId: body.staff_id,
            eventType: 'BILL_HANDOVER_CANCELED',
            payload: { handover_event_id: locked.handoverEventId },
            reasonCode: null,
            reasonText: null,
            originBillId: null,
            originEventIds: null,
            targetRegisterId: null,
            handoverEventId: locked.handoverEventId,
            createdAtDevice: body.created_at_device,
            clockOffsetMs: body.clock_offset_ms,
            occurredAt: nowIso,
            businessDate: bizDate,
            receivedAt: nowIso,
            commandId: body.event_id,
            schemaVersion: body.schema_version ?? SCHEMA_VERSION,
            appVersion: body.app_version ?? meta.appVersion,
          },
        ])

        await updateBillHandoverCanceled(tx, {
          tenantId: device.tenantId,
          billId: locked.id,
          nextSeq,
          nowIso,
        })

        return {
          bill_id: locked.id,
          bill_seq: nextSeq,
          status: 'ACK' as const,
          lease_register_id: locked.leaseRegisterId,
          last_event_seq: nextSeq,
        }
      },
    )

    return {
      ...exec.result,
      server_time: exec.serverTime,
    }
  } catch (err) {
    wrapOnlineConflict(err)
  }
}
