import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  planReceivedSequenceTransition,
  sumActiveGapLength,
  type ActiveInvoiceGap,
} from './invoice-gap'

describe('sales/domain/invoice-gap', () => {
  it('reproduces BR-INV-008 example (121..124, then 127 -> gap [125,126], then 125 -> [126,126], then 126 -> empty)', () => {
    let maxSeq = 124
    let count = 124
    let gaps: ActiveInvoiceGap[] = []
    let nextId = 1

    // Step 1: 127 arrives -> creates [125, 126] OPEN gap
    const p127 = planReceivedSequenceTransition({
      seq: 127,
      maxSeqReceived: maxSeq,
      receivedCount: count,
      activeGaps: gaps,
      existingConflictIndices: [],
    })
    expect(p127.kind).toBe('ADVANCE')
    if (p127.kind !== 'ADVANCE') throw new Error('expected ADVANCE')
    maxSeq = p127.nextMaxSeq
    count = p127.nextReceivedCount
    expect(p127.newGap).toEqual({ seqFrom: 125, seqTo: 126 })
    gaps.push({
      id: `g-${nextId++}`,
      seqFrom: 125,
      seqTo: 126,
      origin: 'DETECTED',
      status: 'OPEN',
      reasonCode: null,
      reasonText: null,
      explainedBy: null,
      explainedAt: null,
      detectedAt: '2026-11-20T00:00:00.000Z',
      registerRecoveryId: null,
    })
    expect(maxSeq - count).toBe(sumActiveGapLength(gaps))

    // Mark gap EXPLAINED and split when 125 arrives -> remainder [126, 126] must inherit EXPLAINED
    gaps[0] = {
      ...gaps[0]!,
      status: 'EXPLAINED',
      reasonCode: 'OFFLINE',
      reasonText: 'Device delayed',
      explainedBy: 'u-1',
      explainedAt: '2026-11-20T01:00:00.000Z',
    }

    const p125 = planReceivedSequenceTransition({
      seq: 125,
      maxSeqReceived: maxSeq,
      receivedCount: count,
      activeGaps: gaps,
      existingConflictIndices: [],
    })
    expect(p125.kind).toBe('FILL_GAP')
    if (p125.kind !== 'FILL_GAP') throw new Error('expected FILL_GAP')
    maxSeq = p125.nextMaxSeq
    count = p125.nextReceivedCount
    gaps = gaps.filter((g) => g.id !== p125.filledGapId)
    for (const r of p125.remainders) {
      gaps.push({ ...r, id: `g-${nextId++}` })
    }
    expect(gaps).toHaveLength(1)
    expect(gaps[0]!.status).toBe('EXPLAINED')
    expect(gaps[0]!.seqFrom).toBe(126)
    expect(gaps[0]!.seqTo).toBe(126)
    expect(maxSeq - count).toBe(sumActiveGapLength(gaps))

    // 126 arrives -> closes remaining gap completely
    const p126 = planReceivedSequenceTransition({
      seq: 126,
      maxSeqReceived: maxSeq,
      receivedCount: count,
      activeGaps: gaps,
      existingConflictIndices: [],
    })
    expect(p126.kind).toBe('FILL_GAP')
    if (p126.kind !== 'FILL_GAP') throw new Error('expected FILL_GAP')
    expect(p126.remainders).toEqual([])
    expect(p126.nextMaxSeq - p126.nextReceivedCount).toBe(0)
  })

  it('maintains max - count == sum(activeGaps) and disjoint intervals across arbitrary arrival orders', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(
          Array.from({ length: 25 }, (_, i) => i + 1),
          { minLength: 1, maxLength: 25 },
        ),
        fc.integer({ min: 0, max: 10 }),
        (arrivals, dupPick) => {
          let maxSeq = 0
          let count = 0
          let gaps: ActiveInvoiceGap[] = []
          const seenDocs = new Map<number, number[]>()
          let nextId = 1

          const seqQueue =
            arrivals.length > 0 && dupPick > 0
              ? [...arrivals, arrivals[dupPick % arrivals.length]!]
              : arrivals

          for (const seq of seqQueue) {
            const existing = seenDocs.get(seq) ?? []
            const plan = planReceivedSequenceTransition({
              seq,
              maxSeqReceived: maxSeq,
              receivedCount: count,
              activeGaps: gaps,
              existingConflictIndices: existing,
            })

            if (plan.kind === 'CONFLICT') {
              seenDocs.set(seq, [...existing, plan.conflictIdx])
            } else if (plan.kind === 'ADVANCE') {
              seenDocs.set(seq, [0])
              maxSeq = plan.nextMaxSeq
              count = plan.nextReceivedCount
              if (plan.newGap) {
                gaps.push({
                  id: `g-${nextId++}`,
                  seqFrom: plan.newGap.seqFrom,
                  seqTo: plan.newGap.seqTo,
                  origin: 'DETECTED',
                  status: 'OPEN',
                  reasonCode: null,
                  reasonText: null,
                  explainedBy: null,
                  explainedAt: null,
                  detectedAt: '2026-11-20T00:00:00.000Z',
                  registerRecoveryId: null,
                })
              }
            } else {
              seenDocs.set(seq, [0])
              maxSeq = plan.nextMaxSeq
              count = plan.nextReceivedCount
              gaps = gaps.filter((g) => g.id !== plan.filledGapId)
              for (const r of plan.remainders) {
                gaps.push({ ...r, id: `g-${nextId++}` })
              }
            }

            // Active gaps never overlap
            const sorted = [...gaps].sort((a, b) => a.seqFrom - b.seqFrom)
            for (let i = 1; i < sorted.length; i += 1) {
              expect(sorted[i]!.seqFrom).toBeGreaterThan(sorted[i - 1]!.seqTo)
            }
            expect(maxSeq - count).toBe(sumActiveGapLength(gaps))
          }
        },
      ),
      { numRuns: 150 },
    )
  })
})
