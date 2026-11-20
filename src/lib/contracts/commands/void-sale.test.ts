import { describe, expect, it } from 'vitest'
import voidSaleFixture from '../../../../tests/fixtures/contracts/v1/VoidSale.json'
import { VoidSalePayloadV1 } from './void-sale'

describe('contracts/commands/void-sale (v1)', () => {
  it('accepts valid VoidSale fixture and rejects self-approval or empty reason', () => {
    const valid = voidSaleFixture as Record<string, unknown>
    expect(VoidSalePayloadV1.parse(valid)).toEqual(valid)

    const selfApprove = structuredClone(valid)
    selfApprove.void_approved_by = selfApprove.voided_by
    expect(() => VoidSalePayloadV1.parse(selfApprove)).toThrow()

    const emptyReason = structuredClone(valid)
    emptyReason.reason_text = '   '
    expect(() => VoidSalePayloadV1.parse(emptyReason)).toThrow()

    const extraProp = { ...structuredClone(valid), unexpected: true }
    expect(() => VoidSalePayloadV1.parse(extraProp)).toThrow()
  })
})
