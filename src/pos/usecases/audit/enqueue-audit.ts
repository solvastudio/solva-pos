import { AppendAuditPayloadV1, SCHEMA_VERSION } from '~/lib/contracts'
import { runtimeIdGenerator as auditIdGen } from '~/lib/runtime-id'
import { enqueueCommandStandalone } from '../../data/outbox.repo'
import type { SolvaDb } from '../../db/solva-db'
import type { OutboxCommandRow } from '../../db/types'

export interface EnqueueAuditInput {
  action: string
  entityType: string
  entityId?: string | null
  registerId: string
  actorUserId?: string | null
  approverUserId?: string | null
  reasonCode?: string | null
  reasonText?: string | null
  beforeData?: Record<string, unknown> | null
  afterData?: Record<string, unknown> | null
  businessDate?: string | null
  occurredAtIso: string
  occurredAtDeviceIso?: string
}

/**
 * Validates and appends a signed/canonical `AppendAudit` outbox command inside a short transaction.
 */
export async function enqueueAudit(
  db: SolvaDb,
  input: EnqueueAuditInput,
): Promise<OutboxCommandRow> {
  const entryId = auditIdGen.newId()
  const occurredAtDevice = input.occurredAtDeviceIso ?? input.occurredAtIso

  const payload = AppendAuditPayloadV1.parse({
    entry: {
      id: entryId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      before_data: input.beforeData ?? null,
      after_data: input.afterData ?? null,
      reason_code: input.reasonCode ?? null,
      reason_text: input.reasonText ?? null,
      actor_user_id: input.actorUserId ?? null,
      approver_user_id: input.approverUserId ?? null,
      occurred_at_device: occurredAtDevice,
      occurred_at: input.occurredAtIso,
      business_date: input.businessDate ?? null,
      related_command_id: null,
    },
  })

  return enqueueCommandStandalone(db, {
    type: 'AppendAudit',
    payload,
    schemaVersion: SCHEMA_VERSION,
    registerId: input.registerId,
    createdAtDevice: occurredAtDevice,
  })
}
