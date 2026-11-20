import { describe, expect, it } from 'vitest'
import closeShiftFixture from '../../../../tests/fixtures/contracts/v1/CloseShift.json'
import openShiftFixture from '../../../../tests/fixtures/contracts/v1/OpenShift.json'
import recordMovementFixture from '../../../../tests/fixtures/contracts/v1/RecordCashMovement.json'
import { CloseShiftPayloadV1, OpenShiftPayloadV1, RecordCashMovementPayloadV1 } from './shift'

describe('contracts/commands/shift (v1)', () => {
  it('validates OpenShift and rejects identity/unknown fields', () => {
    const valid = openShiftFixture as Record<string, unknown>
    expect(OpenShiftPayloadV1.parse(valid)).toEqual(valid)

    const withRegisterId = structuredClone(valid) as { shift: Record<string, unknown> }
    withRegisterId.shift.register_id = '01950000-0000-7000-8000-000000009999'
    expect(() => OpenShiftPayloadV1.parse(withRegisterId)).toThrow()
  })

  it('validates RecordCashMovement and rejects non-positive amount or blank reason', () => {
    const valid = recordMovementFixture as Record<string, unknown>
    expect(RecordCashMovementPayloadV1.parse(valid)).toEqual(valid)

    const zeroAmount = structuredClone(valid) as { movement: Record<string, unknown> }
    zeroAmount.movement.amount = 0
    expect(() => RecordCashMovementPayloadV1.parse(zeroAmount)).toThrow()

    const emptyReason = structuredClone(valid) as { movement: Record<string, unknown> }
    emptyReason.movement.reason_text = '  '
    expect(() => RecordCashMovementPayloadV1.parse(emptyReason)).toThrow()
  })

  it('validates V-21 CloseShift fixture and allows negative variance_device', () => {
    const valid = closeShiftFixture as Record<string, unknown>
    const parsed = CloseShiftPayloadV1.parse(valid)
    expect(parsed.expected_cash_device).toBe(1782100)
    expect(parsed.variance_device).toBe(-2100)

    const floatCounted = structuredClone(valid)
    floatCounted.counted_cash = 100.5
    expect(() => CloseShiftPayloadV1.parse(floatCounted)).toThrow()
  })
})
