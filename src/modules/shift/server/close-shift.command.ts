import '@tanstack/react-start/server-only'
import { parseCommandPayload, type CloseShiftPayloadV1 } from '~/lib/contracts'
import { CommandRejected, type CommandContext, type CommandHandler } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { recomputeShiftRecap } from './recap.service'
import { findShiftFullById, updateCloseShiftRow } from './shift.repo'

/**
 * Handles `CloseShift`: locks blind physical cash count once, computes authoritative
 * server expected cash / variance / completeness, and rejects conflicting recounts (BR-SHF-006).
 */
export const closeShiftCommandHandler: CommandHandler<CloseShiftPayloadV1, TenantTx> = {
  type: 'CloseShift',

  parse(payload: unknown, schemaVersion: number): CloseShiftPayloadV1 {
    return parseCommandPayload('CloseShift', schemaVersion, payload) as CloseShiftPayloadV1
  },

  async handle(
    tx: TenantTx,
    ctx: CommandContext,
    payload: CloseShiftPayloadV1,
  ): Promise<Record<string, unknown>> {
    const shift = await findShiftFullById(tx, payload.shift_id)
    if (!shift) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown shift_id ${payload.shift_id}`,
      )
    }
    if (shift.registerId !== ctx.device.registerId) {
      throw new CommandRejected(
        'AUTHORIZATION',
        'FORBIDDEN',
        'Shift belongs to another register',
      )
    }

    if (shift.status !== 'OPEN') {
      if (shift.countedCash === payload.counted_cash) {
        await recomputeShiftRecap(tx, shift.id, ctx.receivedAtIso)
        return { shift_id: shift.id, status: shift.status }
      }
      throw new CommandRejected(
        'STRUCTURAL',
        'VALIDATION_FAILED',
        'counted_cash cannot be modified on an already-closed shift',
      )
    }

    await updateCloseShiftRow(tx, {
      shiftId: shift.id,
      closedAt: payload.closed_at,
      closedAtDevice: payload.closed_at_device,
      closeCommandId: ctx.commandId,
      countedCash: payload.counted_cash,
      countSubmittedAt: payload.count_submitted_at,
      expectedCashDevice: payload.expected_cash_device,
      varianceDevice: payload.variance_device,
      closeNote: payload.close_note,
    })

    await recomputeShiftRecap(tx, shift.id, ctx.receivedAtIso)

    return {
      shift_id: shift.id,
      status: 'CLOSED',
    }
  },
}
