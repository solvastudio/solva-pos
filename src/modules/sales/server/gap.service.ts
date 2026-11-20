import '@tanstack/react-start/server-only'
import { webcrypto } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { createIdGenerator, isUuid } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import type { InvoiceGapRow } from '../shared'
import { invoiceGap } from './schema'

export type { InvoiceGapRow }

const gapAuditIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

/**
 * Transitions an `OPEN` invoice/credit-note gap to `EXPLAINED` (`gap.annotate`, BR-INV-007).
 */
export async function annotateGap(
  actor: IdentityAuthActor,
  gapId: string,
  input: { reasonCode?: string | null; reasonText: string },
  deps?: { nowIso?: () => string },
): Promise<{ id: string; status: 'EXPLAINED' }> {
  requireActorPermission(actor, 'gap.annotate')
  if (!isUuid(gapId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid gapId')
  }
  const reasonText = input.reasonText.trim()
  if (reasonText.length === 0 || reasonText.length > 500) {
    throw new AppError('VALIDATION_FAILED', 'reasonText is required')
  }
  const reasonCode = input.reasonCode?.trim() || 'EXPLAINED'
  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()

  await withTenant(actor.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: invoiceGap.id,
        outletId: invoiceGap.outletId,
        registerId: invoiceGap.registerId,
        docType: invoiceGap.docType,
        period: invoiceGap.period,
        seqFrom: invoiceGap.seqFrom,
        seqTo: invoiceGap.seqTo,
        status: invoiceGap.status,
      })
      .from(invoiceGap)
      .where(and(eq(invoiceGap.tenantId, actor.tenantId), eq(invoiceGap.id, gapId)))
      .limit(1)

    const gap = rows[0]
    if (!gap) {
      throw new AppError('VALIDATION_FAILED', 'Gap not found')
    }
    requireActorPermission(actor, 'gap.annotate', { outletId: gap.outletId })

    if (gap.status !== 'OPEN') {
      throw new AppError('VALIDATION_FAILED', `Only OPEN gaps can be annotated (got ${gap.status})`)
    }

    await tx
      .update(invoiceGap)
      .set({
        status: 'EXPLAINED',
        reasonCode,
        reasonText,
        explainedBy: actor.appUserId,
        explainedAt: nowIso,
      })
      .where(and(eq(invoiceGap.tenantId, actor.tenantId), eq(invoiceGap.id, gapId)))

    await appendAudit(
      tx,
      {
        action: 'gap.explained',
        entityType: 'invoice_gap',
        entityId: gap.id,
        outletId: gap.outletId,
        registerId: gap.registerId,
        reasonCode,
        reasonText,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
        beforeData: { status: 'OPEN', seq_from: gap.seqFrom, seq_to: gap.seqTo },
        afterData: { status: 'EXPLAINED', reason_code: reasonCode },
      },
      { newId: () => gapAuditIdGen.newId(), nowIso: () => nowIso },
    )
  })

  return { id: gapId, status: 'EXPLAINED' }
}

/**
 * Lists detected and recovery-declared document gaps for admin review and annotation (Phase 49).
 */
export async function listGaps(
  actor: IdentityAuthActor,
  filter?: { outletId?: string; status?: 'OPEN' | 'EXPLAINED' | 'FILLED' },
): Promise<InvoiceGapRow[]> {
  requireActorPermission(actor, 'gap.annotate')
  const allowedOutletIds = actor.outletIds

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const conditions = [eq(invoiceGap.tenantId, actor.tenantId)]
    if (filter?.outletId) {
      requireActorPermission(actor, 'gap.annotate', { outletId: filter.outletId })
      conditions.push(eq(invoiceGap.outletId, filter.outletId))
    } else if (allowedOutletIds !== null && allowedOutletIds !== undefined) {
      if (allowedOutletIds.length === 0) return []
      conditions.push(inArray(invoiceGap.outletId, allowedOutletIds))
    }
    if (filter?.status) {
      conditions.push(eq(invoiceGap.status, filter.status))
    }

    const rows = await tx
      .select({
        id: invoiceGap.id,
        outletId: invoiceGap.outletId,
        registerId: invoiceGap.registerId,
        docType: invoiceGap.docType,
        period: invoiceGap.period,
        seqFrom: invoiceGap.seqFrom,
        seqTo: invoiceGap.seqTo,
        origin: invoiceGap.origin,
        status: invoiceGap.status,
        reasonCode: invoiceGap.reasonCode,
        reasonText: invoiceGap.reasonText,
        explainedBy: invoiceGap.explainedBy,
        explainedAt: invoiceGap.explainedAt,
        filledAt: invoiceGap.filledAt,
        detectedAt: invoiceGap.detectedAt,
      })
      .from(invoiceGap)
      .where(and(...conditions))
      .orderBy(desc(invoiceGap.detectedAt), desc(invoiceGap.seqFrom))
      .limit(200)

    return rows.map((r) => ({
      ...r,
      docType: r.docType as 'INVOICE' | 'CREDIT_NOTE',
      origin: r.origin as 'DETECTED' | 'RECOVERY_DECLARED',
      status: r.status as 'OPEN' | 'EXPLAINED' | 'FILLED',
    }))
  })
}
