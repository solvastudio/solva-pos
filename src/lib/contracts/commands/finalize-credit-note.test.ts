import { describe, expect, it } from 'vitest'
import cnFixture from '../../../../tests/fixtures/contracts/v1/FinalizeCreditNote.json'
import { FinalizeCreditNotePayloadV1 } from './finalize-credit-note'

describe('contracts/commands/finalize-credit-note (v1)', () => {
  it('accepts V-18 credit note fixture and rejects self-approval, bad qty, or extra fields', () => {
    const valid = cnFixture as Record<string, unknown>
    const parsed = FinalizeCreditNotePayloadV1.parse(valid)
    expect(parsed.credit_note.refund_gross).toBe(17882)
    expect(parsed.credit_note.rounding).toBe(18)
    expect(parsed.refunds[0]!.amount_applied).toBe(17900)

    const selfApprove = structuredClone(valid) as { credit_note: Record<string, unknown> }
    selfApprove.credit_note.approved_by = selfApprove.credit_note.created_by
    expect(() => FinalizeCreditNotePayloadV1.parse(selfApprove)).toThrow()

    const zeroQty = structuredClone(valid) as { lines: Array<Record<string, unknown>> }
    zeroQty.lines[0]!.qty_returned = '0'
    expect(() => FinalizeCreditNotePayloadV1.parse(zeroQty)).toThrow()

    const unknownField = { ...structuredClone(valid), extra: 1 }
    expect(() => FinalizeCreditNotePayloadV1.parse(unknownField)).toThrow()
  })
})
