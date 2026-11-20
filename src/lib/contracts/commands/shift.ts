import { z } from 'zod'
import { CASH_MOVEMENT_DIRECTION } from '../enums'
import { zBusinessDate, zIso, zMoney, zMoneyNonNeg, zMoneyPositive, zUuid } from '../primitives'

export const OpenShiftBodyV1Schema = z
  .object({
    id: zUuid,
    created_by: zUuid,
    created_at_device: zIso,
    clock_offset_ms: zMoney,
    occurred_at: zIso,
    business_date: zBusinessDate,
    opening_cash: zMoneyNonNeg,
  })
  .strict()

export const OpenShiftPayloadV1 = z
  .object({
    shift: OpenShiftBodyV1Schema,
  })
  .strict()

export const CashMovementBodyV1Schema = z
  .object({
    id: zUuid,
    shift_id: zUuid,
    created_by: zUuid,
    created_at_device: zIso,
    clock_offset_ms: zMoney,
    occurred_at: zIso,
    business_date: zBusinessDate,
    direction: z.enum(CASH_MOVEMENT_DIRECTION),
    amount: zMoneyPositive,
    reason_code: z.string().min(1).max(40),
    reason_text: z.string().trim().min(1).max(500),
  })
  .strict()

export const RecordCashMovementPayloadV1 = z
  .object({
    movement: CashMovementBodyV1Schema,
  })
  .strict()

export const CloseShiftPayloadV1 = z
  .object({
    shift_id: zUuid,
    counted_cash: zMoneyNonNeg,
    count_submitted_at: zIso,
    closed_at: zIso,
    closed_at_device: zIso,
    expected_cash_device: zMoney,
    variance_device: zMoney,
    close_note: z.string().max(300).nullable(),
  })
  .strict()

export type OpenShiftPayloadV1 = z.infer<typeof OpenShiftPayloadV1>
export type RecordCashMovementPayloadV1 = z.infer<typeof RecordCashMovementPayloadV1>
export type CloseShiftPayloadV1 = z.infer<typeof CloseShiftPayloadV1>
