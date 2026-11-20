import '@tanstack/react-start/server-only'
import { formatInvoiceNo } from '~/lib/kernel'
import type { TenantTx } from '~/server/db'
import { planReceivedSequenceTransition } from '../domain/invoice-gap'
import {
  insertDetectedGapRow,
  insertRemainderGapRow,
  listActiveInvoiceGaps,
  listExistingSeqConflictIndices,
  lockOrInitInvoiceSeries,
  markGapRowFilled,
  updateInvoiceSeriesCounters,
  type DocType,
} from './invoice-series.repo'

export interface RegisterNumberResult {
  readonly isConflict: boolean
  readonly conflictIdx: number
  readonly finalNo: string
}

/**
 * Atomically locks `invoice_series` for `(registerId, docType, period)`, detects/splits/fills gaps
 * or assigns `-Dn` on sequence collision (BR-INV-006..010).
 */
export async function registerReceivedNumber(
  tx: TenantTx,
  params: {
    tenantId: string
    outletId: string
    registerId: string
    docType: DocType
    docId: string
    prefix: string
    period: string
    seq: number
    receivedAtIso: string
  },
): Promise<RegisterNumberResult> {
  const series = await lockOrInitInvoiceSeries(tx, {
    tenantId: params.tenantId,
    outletId: params.outletId,
    registerId: params.registerId,
    docType: params.docType,
    period: params.period,
  })

  const existingConflicts = await listExistingSeqConflictIndices(tx, {
    tenantId: params.tenantId,
    registerId: params.registerId,
    docType: params.docType,
    period: params.period,
    seq: params.seq,
    excludeDocId: params.docId,
  })

  const activeGaps =
    existingConflicts.length === 0 && params.seq <= series.maxSeqReceived
      ? await listActiveInvoiceGaps(tx, {
          tenantId: params.tenantId,
          registerId: params.registerId,
          docType: params.docType,
          period: params.period,
        })
      : []

  const plan = planReceivedSequenceTransition({
    seq: params.seq,
    maxSeqReceived: series.maxSeqReceived,
    receivedCount: series.receivedCount,
    activeGaps,
    existingConflictIndices: existingConflicts,
  })

  if (plan.kind === 'CONFLICT') {
    return {
      isConflict: true,
      conflictIdx: plan.conflictIdx,
      finalNo: formatInvoiceNo({
        prefix: params.prefix,
        kind: params.docType,
        period: params.period,
        seq: params.seq,
        conflictIdx: plan.conflictIdx,
      }),
    }
  }

  if (plan.kind === 'ADVANCE') {
    await updateInvoiceSeriesCounters(tx, {
      registerId: params.registerId,
      docType: params.docType,
      period: params.period,
      maxSeqReceived: plan.nextMaxSeq,
      receivedCount: plan.nextReceivedCount,
      receivedAtIso: params.receivedAtIso,
    })

    if (plan.newGap) {
      await insertDetectedGapRow(tx, {
        tenantId: params.tenantId,
        outletId: params.outletId,
        registerId: params.registerId,
        docType: params.docType,
        period: params.period,
        seqFrom: plan.newGap.seqFrom,
        seqTo: plan.newGap.seqTo,
        detectedAtIso: params.receivedAtIso,
      })
    }
  } else {
    // Update the hit gap to FILLED first so the partial EXCLUDE constraint frees the subranges.
    await markGapRowFilled(tx, {
      gapId: plan.filledGapId,
      fillSeq: plan.fillSeq,
      filledAtIso: params.receivedAtIso,
    })

    for (const rem of plan.remainders) {
      await insertRemainderGapRow(tx, {
        tenantId: params.tenantId,
        outletId: params.outletId,
        registerId: params.registerId,
        docType: params.docType,
        period: params.period,
        spec: rem,
      })
    }

    await updateInvoiceSeriesCounters(tx, {
      registerId: params.registerId,
      docType: params.docType,
      period: params.period,
      maxSeqReceived: plan.nextMaxSeq,
      receivedCount: plan.nextReceivedCount,
      receivedAtIso: params.receivedAtIso,
    })
  }

  return {
    isConflict: false,
    conflictIdx: 0,
    finalNo: formatInvoiceNo({
      prefix: params.prefix,
      kind: params.docType,
      period: params.period,
      seq: params.seq,
    }),
  }
}
