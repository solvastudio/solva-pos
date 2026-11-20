import '@tanstack/react-start/server-only'
import { parseCommandPayload, type RecordCashMovementPayloadV1 } from '~/lib/contracts'
import { findMissingAppUserId } from '~/modules/identity/public'
import { CommandRejected, type CommandContext, type CommandHandler } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { recomputeRecapIfClosed } from './recap.service'
import { getShiftForCommand, insertCashMovementRow } from './shift.repo'

/**
 * Handles `RecordCashMovement`, accepting late arrivals on closed shifts as facts and
 * updating shift cash recaps accordingly.
 */
export const recordCashMovementCommandHandler: CommandHandler<
  RecordCashMovementPayloadV1,
  TenantTx
> = {
  type: 'RecordCashMovement',

  parse(payload: unknown, schemaVersion: number): RecordCashMovementPayloadV1 {
    return parseCommandPayload(
      'RecordCashMovement',
      schemaVersion,
      payload,
    ) as RecordCashMovementPayloadV1
  },

  async handle(
    tx: TenantTx,
    ctx: CommandContext,
    payload: RecordCashMovementPayloadV1,
  ): Promise<Record<string, unknown>> {
    const m = payload.movement
    const tenantId = ctx.device.tenantId

    const missingUser = await findMissingAppUserId(tx, tenantId, [m.created_by])
    if (missingUser) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown user_id ${missingUser}`)
    }

    const shift = await getShiftForCommand(tx, m.shift_id)
    if (!shift) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown shift_id ${m.shift_id}`)
    }
    if (shift.registerId !== ctx.device.registerId) {
      throw new CommandRejected(
        'AUTHORIZATION',
        'FORBIDDEN',
        'Cash movement shift belongs to another register',
      )
    }

    await insertCashMovementRow(tx, {
      id: m.id,
      tenantId,
      outletId: ctx.device.outletId,
      registerId: ctx.device.registerId,
      deviceId: ctx.device.deviceId,
      createdBy: m.created_by,
      createdAtDevice: m.created_at_device,
      clockOffsetMs: m.clock_offset_ms,
      occurredAt: m.occurred_at,
      businessDate: m.business_date,
      receivedAt: ctx.receivedAtIso,
      commandId: ctx.commandId,
      schemaVersion: ctx.schemaVersion,
      appVersion: ctx.appVersion,
      shiftId: m.shift_id,
      direction: m.direction,
      amount: m.amount,
      reasonCode: m.reason_code,
      reasonText: m.reason_text,
    })

    await recomputeRecapIfClosed(tx, m.shift_id, ctx.receivedAtIso)

    return {
      movement_id: m.id,
      shift_id: m.shift_id,
    }
  },
}
