import '@tanstack/react-start/server-only'
import { parseCommandPayload, type ReportPinStatePayloadV1 } from '~/lib/contracts'
import { appendAudit } from '~/modules/audit/public'
import {
  CommandRejected,
  type CommandContext,
  type CommandHandler,
} from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { identityIdGen } from './code-crypto'
import { findAppUserActiveForPin, upsertStaffPinStateMonotonic } from './pin.repo'

/**
 * Handles `ReportPinState`: persists per-(user, device) local PIN attempt/lock state
 * only when `device_seq > last_device_seq` (older reports stay idempotently ACKed), and
 * emits `pin.locked` audit when `lock_tier = 3` (BR-AUT-005, SCHEMA §4.1.18).
 */
export const reportPinStateCommandHandler: CommandHandler<ReportPinStatePayloadV1, TenantTx> = {
  type: 'ReportPinState',

  parse(payload: unknown, schemaVersion: number): ReportPinStatePayloadV1 {
    return parseCommandPayload(
      'ReportPinState',
      schemaVersion,
      payload,
    ) as ReportPinStatePayloadV1
  },

  async handle(
    tx: TenantTx,
    ctx: CommandContext,
    payload: ReportPinStatePayloadV1,
  ): Promise<Record<string, unknown>> {
    const user = await findAppUserActiveForPin(tx, ctx.device.tenantId, payload.user_id)
    if (!user) {
      throw new CommandRejected(
        'STRUCTURAL',
        'UNKNOWN_REFERENCE',
        `Unknown user_id ${payload.user_id}`,
      )
    }

    const { applied } = await upsertStaffPinStateMonotonic(tx, {
      userId: payload.user_id,
      deviceId: ctx.device.deviceId,
      tenantId: ctx.device.tenantId,
      failedCount: payload.failed_count,
      lockTier: payload.lock_tier,
      lockedUntil: payload.locked_until,
      lastFailedAt: payload.last_failed_at,
      pinEpochSeen: payload.pin_epoch_seen,
      reportedAt: ctx.receivedAtIso,
      deviceSeq: ctx.deviceSeq,
    })

    if (applied && payload.lock_tier === 3) {
      await appendAudit(
        tx,
        {
          action: 'pin.locked',
          entityType: 'staff_pin_state',
          entityId: payload.user_id,
          actorUserId: payload.user_id,
          outletId: ctx.device.outletId,
          registerId: ctx.device.registerId,
          deviceId: ctx.device.deviceId,
          commandId: ctx.commandId,
          requestRef: ctx.requestRef,
          occurredAt: ctx.receivedAtIso,
          occurredAtDevice: ctx.createdAtDevice,
          clockOffsetMs: ctx.clockOffsetMs,
          afterData: {
            failed_count: payload.failed_count,
            lock_tier: payload.lock_tier,
            epoch: payload.pin_epoch_seen,
          },
        },
        { newId: () => identityIdGen.newId(), nowIso: () => ctx.receivedAtIso },
      )
    }

    return { applied }
  },
}
