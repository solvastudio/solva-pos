import '@tanstack/react-start/server-only'
import { webcrypto } from 'node:crypto'
import { createIdGenerator } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import type { TenantTx } from '~/server/db'

const auditIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

/** Audit peristiwa dokumen inventori (GR/transfer/opname). Dipanggil terakhir dalam transaksi. */
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
