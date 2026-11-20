import '@tanstack/react-start/server-only'
import { webcrypto } from 'node:crypto'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { createIdGenerator } from '~/lib/kernel'
import type { TenantTx } from '~/server/db'
import type { ActiveInvoiceGap, RemainderGapSpec } from '../domain/invoice-gap'
import { creditNote, invoiceGap, invoiceSeries, sale } from './schema'

export type DocType = 'INVOICE' | 'CREDIT_NOTE'

const gapIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

export async function lockOrInitInvoiceSeries(
  tx: TenantTx,
  params: {
    tenantId: string
    outletId: string
    registerId: string
    docType: DocType
    period: string
  },
): Promise<{ maxSeqReceived: number; receivedCount: number }> {
  await tx
    .insert(invoiceSeries)
    .values({
      registerId: params.registerId,
      docType: params.docType,
      period: params.period,
      tenantId: params.tenantId,
      outletId: params.outletId,
      maxSeqReceived: 0,
      receivedCount: 0,
    })
    .onConflictDoNothing()

  const locked = await tx.execute(
    sql`SELECT max_seq_received, received_count
        FROM invoice_series
        WHERE register_id = ${params.registerId}::uuid
          AND doc_type = ${params.docType}
          AND period = ${params.period}
        FOR UPDATE`,
  )
  const row = locked.rows[0] as { max_seq_received?: unknown; received_count?: unknown } | undefined
  return {
    maxSeqReceived: Number(row?.max_seq_received ?? 0),
    receivedCount: Number(row?.received_count ?? 0),
  }
}

export async function listExistingSeqConflictIndices(
  tx: TenantTx,
  params: {
    tenantId: string
    registerId: string
    docType: DocType
    period: string
    seq: number
    excludeDocId: string
  },
): Promise<number[]> {
  if (params.docType === 'INVOICE') {
    const rows = await tx
      .select({ conflictIdx: sale.invoiceConflictIdx })
      .from(sale)
      .where(
        and(
          eq(sale.tenantId, params.tenantId),
          eq(sale.registerId, params.registerId),
          eq(sale.invoicePeriod, params.period),
          eq(sale.invoiceSeq, params.seq),
          ne(sale.id, params.excludeDocId),
        ),
      )
    return rows.map((r) => r.conflictIdx)
  }

  const rows = await tx
    .select({ conflictIdx: creditNote.cnConflictIdx })
    .from(creditNote)
    .where(
      and(
        eq(creditNote.tenantId, params.tenantId),
        eq(creditNote.registerId, params.registerId),
        eq(creditNote.cnPeriod, params.period),
        eq(creditNote.cnSeq, params.seq),
        ne(creditNote.id, params.excludeDocId),
      ),
    )
  return rows.map((r) => r.conflictIdx)
}

export async function listActiveInvoiceGaps(
  tx: TenantTx,
  params: {
    tenantId: string
    registerId: string
    docType: DocType
    period: string
  },
): Promise<ActiveInvoiceGap[]> {
  const rows = await tx
    .select({
      id: invoiceGap.id,
      seqFrom: invoiceGap.seqFrom,
      seqTo: invoiceGap.seqTo,
      origin: invoiceGap.origin,
      status: invoiceGap.status,
      reasonCode: invoiceGap.reasonCode,
      reasonText: invoiceGap.reasonText,
      explainedBy: invoiceGap.explainedBy,
      explainedAt: invoiceGap.explainedAt,
      detectedAt: invoiceGap.detectedAt,
      registerRecoveryId: invoiceGap.registerRecoveryId,
    })
    .from(invoiceGap)
    .where(
      and(
        eq(invoiceGap.tenantId, params.tenantId),
        eq(invoiceGap.registerId, params.registerId),
        eq(invoiceGap.docType, params.docType),
        eq(invoiceGap.period, params.period),
        inArray(invoiceGap.status, ['OPEN', 'EXPLAINED']),
      ),
    )
    .orderBy(asc(invoiceGap.seqFrom))

  return rows.map((r) => ({
    ...r,
    origin: r.origin as 'DETECTED' | 'RECOVERY_DECLARED',
    status: r.status as 'OPEN' | 'EXPLAINED',
  }))
}

export async function updateInvoiceSeriesCounters(
  tx: TenantTx,
  params: {
    registerId: string
    docType: DocType
    period: string
    maxSeqReceived: number
    receivedCount: number
    receivedAtIso: string
  },
): Promise<void> {
  await tx
    .update(invoiceSeries)
    .set({
      maxSeqReceived: params.maxSeqReceived,
      receivedCount: params.receivedCount,
      lastReceivedAt: params.receivedAtIso,
      updatedAt: params.receivedAtIso,
    })
    .where(
      and(
        eq(invoiceSeries.registerId, params.registerId),
        eq(invoiceSeries.docType, params.docType),
        eq(invoiceSeries.period, params.period),
      ),
    )
}

export async function insertDetectedGapRow(
  tx: TenantTx,
  params: {
    tenantId: string
    outletId: string
    registerId: string
    docType: DocType
    period: string
    seqFrom: number
    seqTo: number
    detectedAtIso: string
  },
): Promise<void> {
  await tx.insert(invoiceGap).values({
    id: gapIdGen.newId(),
    tenantId: params.tenantId,
    outletId: params.outletId,
    registerId: params.registerId,
    docType: params.docType,
    period: params.period,
    seqFrom: params.seqFrom,
    seqTo: params.seqTo,
    origin: 'DETECTED',
    status: 'OPEN',
    detectedAt: params.detectedAtIso,
  })
}

export async function markGapRowFilled(
  tx: TenantTx,
  params: { gapId: string; fillSeq: number; filledAtIso: string },
): Promise<void> {
  await tx
    .update(invoiceGap)
    .set({
      seqFrom: params.fillSeq,
      seqTo: params.fillSeq,
      status: 'FILLED',
      filledAt: params.filledAtIso,
    })
    .where(eq(invoiceGap.id, params.gapId))
}

export async function insertRemainderGapRow(
  tx: TenantTx,
  params: {
    tenantId: string
    outletId: string
    registerId: string
    docType: DocType
    period: string
    spec: RemainderGapSpec
  },
): Promise<void> {
  await tx.insert(invoiceGap).values({
    id: gapIdGen.newId(),
    tenantId: params.tenantId,
    outletId: params.outletId,
    registerId: params.registerId,
    docType: params.docType,
    period: params.period,
    seqFrom: params.spec.seqFrom,
    seqTo: params.spec.seqTo,
    origin: params.spec.origin,
    status: params.spec.status,
    reasonCode: params.spec.reasonCode,
    reasonText: params.spec.reasonText,
    explainedBy: params.spec.explainedBy,
    explainedAt: params.spec.explainedAt,
    detectedAt: params.spec.detectedAt,
    registerRecoveryId: params.spec.registerRecoveryId,
  })
}
