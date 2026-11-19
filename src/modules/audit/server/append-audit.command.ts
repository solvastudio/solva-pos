import '@tanstack/react-start/server-only'
import { AppendAuditPayloadV1 } from '~/lib/contracts'
import {
  CommandRejected,
  type CommandContext,
  type CommandHandler,
} from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { tenantCommandExists, tenantUserExists } from './audit.repo'
import { appendAudit } from './audit.service'

/**
 * Handles the offline/outbox `AppendAudit` sync command inside the command's tenant transaction.
 */
export const appendAuditCommandHandler: CommandHandler<AppendAuditPayloadV1, TenantTx> = {
  type: 'AppendAudit',

  parse(payload: unknown, schemaVersion: number): AppendAuditPayloadV1 {
    if (schemaVersion !== 1) {
      throw new CommandRejected(
        'STRUCTURAL',
        'SCHEMA_NOT_MIGRATABLE',
        `Unsupported AppendAudit schema version: ${schemaVersion}`,
      )
    }
    return AppendAuditPayloadV1.parse(payload)
  },

  async handle(
    tx: TenantTx,
    ctx: CommandContext,
    payload: AppendAuditPayloadV1,
  ): Promise<Record<string, unknown>> {
    const { entry } = payload
    const tenantId = ctx.device.tenantId

    if (entry.actor_user_id !== null) {
      const exists = await tenantUserExists(tx, tenantId, entry.actor_user_id)
      if (!exists) {
        throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', 'Unknown actor_user_id for tenant')
      }
    }

    if (entry.approver_user_id !== null) {
      const exists = await tenantUserExists(tx, tenantId, entry.approver_user_id)
      if (!exists) {
        throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', 'Unknown approver_user_id for tenant')
      }
    }

    let linkedCommandId = ctx.commandId
    if (entry.related_command_id !== null && entry.related_command_id !== ctx.commandId) {
      const cmdExists = await tenantCommandExists(tx, tenantId, entry.related_command_id)
      if (!cmdExists) {
        throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', 'Unknown related_command_id for tenant')
      }
      linkedCommandId = entry.related_command_id
    }

    try {
      const appended = await appendAudit(
        tx,
        {
          id: entry.id,
          action: entry.action,
          entityType: entry.entity_type,
          entityId: entry.entity_id,
          beforeData: entry.before_data,
          afterData: entry.after_data,
          reasonCode: entry.reason_code,
          reasonText: entry.reason_text,
          actorUserId: entry.actor_user_id,
          approverUserId: entry.approver_user_id,
          outletId: ctx.device.outletId,
          registerId: ctx.device.registerId,
          deviceId: ctx.device.deviceId,
          occurredAtDevice: entry.occurred_at_device ?? ctx.createdAtDevice,
          clockOffsetMs: ctx.clockOffsetMs,
          occurredAt: entry.occurred_at,
          businessDate: entry.business_date,
          commandId: linkedCommandId,
          requestRef: ctx.requestRef,
          schemaVersion: ctx.schemaVersion,
          appVersion: ctx.appVersion,
        },
        {
          newId: () => entry.id,
          nowIso: () => ctx.receivedAtIso,
        },
      )

      return {
        audit_id: appended.id,
        chain_seq: appended.chainSeq,
      }
    } catch (err) {
      if (err instanceof AppError && err.code === 'VALIDATION_FAILED') {
        throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', err.message)
      }
      if (err instanceof RangeError) {
        throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', err.message)
      }
      throw err
    }
  },
}
