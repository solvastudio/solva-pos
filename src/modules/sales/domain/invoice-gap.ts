export interface ActiveInvoiceGap {
  readonly id: string
  readonly seqFrom: number
  readonly seqTo: number
  readonly origin: 'DETECTED' | 'RECOVERY_DECLARED'
  readonly status: 'OPEN' | 'EXPLAINED'
  readonly reasonCode: string | null
  readonly reasonText: string | null
  readonly explainedBy: string | null
  readonly explainedAt: string | null
  readonly detectedAt: string
  readonly registerRecoveryId: string | null
}

export interface RemainderGapSpec {
  readonly seqFrom: number
  readonly seqTo: number
  readonly origin: 'DETECTED' | 'RECOVERY_DECLARED'
  readonly status: 'OPEN' | 'EXPLAINED'
  readonly reasonCode: string | null
  readonly reasonText: string | null
  readonly explainedBy: string | null
  readonly explainedAt: string | null
  readonly detectedAt: string
  readonly registerRecoveryId: string | null
}

export type SeriesTransitionPlan =
  | {
      readonly kind: 'ADVANCE'
      readonly nextMaxSeq: number
      readonly nextReceivedCount: number
      readonly newGap: { readonly seqFrom: number; readonly seqTo: number } | null
    }
  | {
      readonly kind: 'FILL_GAP'
      readonly nextMaxSeq: number
      readonly nextReceivedCount: number
      readonly filledGapId: string
      readonly fillSeq: number
      readonly remainders: readonly RemainderGapSpec[]
    }
  | {
      readonly kind: 'CONFLICT'
      readonly nextMaxSeq: number
      readonly nextReceivedCount: number
      readonly conflictIdx: number
    }

/**
 * Pure state machine deciding how an incoming sequence number updates `invoice_series`
 * and `invoice_gap` rows while preserving `max_seq_received - received_count = sum(active gaps)`.
 */
export function planReceivedSequenceTransition(input: {
  seq: number
  maxSeqReceived: number
  receivedCount: number
  activeGaps: readonly ActiveInvoiceGap[]
  existingConflictIndices: readonly number[]
}): SeriesTransitionPlan {
  if (!Number.isSafeInteger(input.seq) || input.seq < 1) {
    throw new RangeError(`seq must be integer >= 1: ${input.seq}`)
  }

  // Another document already claimed this sequence on this register/period.
  if (input.existingConflictIndices.length > 0) {
    const maxConflict = Math.max(0, ...input.existingConflictIndices)
    return {
      kind: 'CONFLICT',
      nextMaxSeq: input.maxSeqReceived,
      nextReceivedCount: input.receivedCount,
      conflictIdx: maxConflict + 1,
    }
  }

  if (input.seq === input.maxSeqReceived + 1) {
    return {
      kind: 'ADVANCE',
      nextMaxSeq: input.seq,
      nextReceivedCount: input.receivedCount + 1,
      newGap: null,
    }
  }

  if (input.seq > input.maxSeqReceived + 1) {
    return {
      kind: 'ADVANCE',
      nextMaxSeq: input.seq,
      nextReceivedCount: input.receivedCount + 1,
      newGap: {
        seqFrom: input.maxSeqReceived + 1,
        seqTo: input.seq - 1,
      },
    }
  }

  // Late arrival (seq <= maxSeqReceived): check whether an active OPEN/EXPLAINED gap covers seq.
  const targetGap = input.activeGaps.find((g) => g.seqFrom <= input.seq && input.seq <= g.seqTo)
  if (!targetGap) {
    return {
      kind: 'CONFLICT',
      nextMaxSeq: input.maxSeqReceived,
      nextReceivedCount: input.receivedCount,
      conflictIdx: 1,
    }
  }

  const remainders: RemainderGapSpec[] = []
  const inherited = {
    origin: targetGap.origin,
    status: targetGap.status,
    reasonCode: targetGap.reasonCode,
    reasonText: targetGap.reasonText,
    explainedBy: targetGap.explainedBy,
    explainedAt: targetGap.explainedAt,
    detectedAt: targetGap.detectedAt,
    registerRecoveryId: targetGap.registerRecoveryId,
  }

  if (targetGap.seqFrom < input.seq) {
    remainders.push({
      ...inherited,
      seqFrom: targetGap.seqFrom,
      seqTo: input.seq - 1,
    })
  }
  if (input.seq < targetGap.seqTo) {
    remainders.push({
      ...inherited,
      seqFrom: input.seq + 1,
      seqTo: targetGap.seqTo,
    })
  }

  return {
    kind: 'FILL_GAP',
    nextMaxSeq: input.maxSeqReceived,
    nextReceivedCount: input.receivedCount + 1,
    filledGapId: targetGap.id,
    fillSeq: input.seq,
    remainders,
  }
}

export function sumActiveGapLength(
  gaps: ReadonlyArray<{ readonly seqFrom: number; readonly seqTo: number }>,
): number {
  let total = 0
  for (const g of gaps) {
    total += g.seqTo - g.seqFrom + 1
  }
  return total
}
