import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { parseCommandPayload, type OpenShiftPayloadV1 } from '~/lib/contracts'
import { findMissingAppUserId } from '~/modules/identity/public'
import { CommandRejected, type CommandContext, type CommandHandler } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { findOpenShiftIdByRegister, insertOpenShiftRow } from './shift.repo'

/**
 * Handles `OpenShift`: inserts an OPEN cashier shift or routes concurrent/recovered
 * duplicate OPEN shift violations to `attention_item` with `SHIFT_ALREADY_OPEN` (EC-034).
 */
export const openShiftCommandHandler: CommandHandler<OpenShiftPayloadV1, TenantTx> = {
  type: 'OpenShift',

  parse(payload: unknown, schemaVersion: number): OpenShiftPayloadV1 {
    return parseCommandPayload('OpenShift', schemaVersion, payload) as OpenShiftPayloadV1
  },

  async handle(
    tx: TenantTx,
    ctx: CommandContext,
    payload: OpenShiftPayloadV1,
  ): Promise<Record<string, unknown>> {
    const s = payload.shift
    const tenantId = ctx.device.tenantId

    const missingUser = await findMissingAppUserId(tx, tenantId, [s.created_by])
    if (missingUser) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown user_id ${missingUser}`)
    }

    const existingOpen = await findOpenShiftIdByRegister(tx, tenantId, ctx.device.registerId)
    if (existingOpen) {
      throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', 'SHIFT_ALREADY_OPEN')
    }

    await tx.execute(sql`SAVEPOINT sp_open_shift`)
    try {
      await insertOpenShiftRow(tx, {
        id: s.id,
        tenantId,
        outletId: ctx.device.outletId,
        registerId: ctx.device.registerId,
        deviceId: ctx.device.deviceId,
        createdBy: s.created_by,
        createdAtDevice: s.created_at_device,
        clockOffsetMs: s.clock_offset_ms,
        occurredAt: s.occurred_at,
        businessDate: s.business_date,
        receivedAt: ctx.receivedAtIso,
        commandId: ctx.commandId,
        schemaVersion: ctx.schemaVersion,
        appVersion: ctx.appVersion,
        openingCash: s.opening_cash,
      })
      await tx.execute(sql`RELEASE SAVEPOINT sp_open_shift`)
    } catch (err: unknown) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT sp_open_shift`)
      await tx.execute(sql`RELEASE SAVEPOINT sp_open_shift`)
      const pgErr = err as { code?: string; constraint?: string } | null
      if (pgErr?.code === '23505' && pgErr.constraint === 'uq_cash_cashier__open_register') {
        throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', 'SHIFT_ALREADY_OPEN')
      }
      if (pgErr?.code === '23505') {
        throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', `Duplicate shift id ${s.id}`)
      }
      throw err
    }

    return { shift_id: s.id }
  },
}
