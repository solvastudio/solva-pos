import '@tanstack/react-start/server-only'
import { runtimeIdGenerator as auditIdGen } from '~/lib/runtime-id'
import { appendAudit } from '~/modules/audit/public'
import type { TenantTx } from '~/server/db'

/** Audits an inventory document event (GR, transfer, stocktake). Called last within the transaction. */
export async function auditInventoryEvent(
  tx: TenantTx,
  input: {
    action: 'gr.posted' | 'gr.reversed' | 'transfer.sent' | 'transfer.received' | 'stocktake.posted' | 'outlet.changed'
    entityType: string
    entityId: string
    outletId: string
    actorUserId: string
    reasonText?: string | null
    afterData?: unknown
  },
): Promise<void> {
  const nowIso = new Date().toISOString()
  await appendAudit(
    tx,
    {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      outletId: input.outletId,
      actorUserId: input.actorUserId,
      reasonText: input.reasonText ?? null,
      afterData: input.afterData,
      occurredAt: nowIso,
    },
    { newId: () => auditIdGen.newId(), nowIso: () => nowIso },
  )
}
