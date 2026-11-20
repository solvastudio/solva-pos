import { z } from 'zod'
import { PAYMENT_METHOD_KIND, PRICE_TAX_MODE, RETURN_DISPOSITION } from '../enums'
import {
  zBusinessDate,
  zCashRoundingUnit,
  zIso,
  zMoney,
  zMoneyNonNeg,
  zMoneyPositive,
  zPeriod,
  zQtyPositive,
  zReceiptLocale,
  zSafePosInt,
  zUuid,
} from '../primitives'

export const CreditNoteHeaderV1Schema = z
  .object({
    id: zUuid,
    shift_id: zUuid,
    created_by: zUuid,
    approved_by: zUuid,
    created_at_device: zIso,
    clock_offset_ms: zMoney,
    occurred_at: zIso,
    business_date: zBusinessDate,
    cn_no: z.string().min(1).max(40),
    cn_prefix: z.string().min(2).max(16),
    cn_period: zPeriod,
    cn_seq: zSafePosInt,
    original_sale_id: zUuid,
    original_invoice_no: z.string().min(1).max(40),
    reason_code: z.string().min(1).max(40),
    reason_text: z.string().max(500).nullable(),
    price_tax_mode: z.enum(PRICE_TAX_MODE),
    cash_rounding_unit: zCashRoundingUnit,
    receipt_locale: zReceiptLocale,
    net_total: zMoneyNonNeg,
    service_total: zMoneyNonNeg,
    tax_total: zMoneyNonNeg,
    refund_gross: zMoneyNonNeg,
    rounding: zMoney,
  })
  .strict()
  .superRefine((cn, ctx) => {
    if (cn.approved_by === cn.created_by) {
      ctx.addIssue({
        code: 'custom',
        path: ['approved_by'],
        message: 'approved_by must differ from created_by',
      })
    }
  })

export const CreditNoteLineV1Schema = z
  .object({
    id: zUuid,
    line_no: zSafePosInt,
    sale_line_id: zUuid,
    qty_returned: zQtyPositive,
    qty_returned_base: zQtyPositive,
    refund_net: zMoneyNonNeg,
    refund_service: zMoneyNonNeg,
    refund_tax: zMoneyNonNeg,
    is_final_return: z.boolean(),
    disposition: z.enum(RETURN_DISPOSITION).nullable(),
  })
  .strict()

export const CreditNoteRefundV1Schema = z
  .object({
    id: zUuid,
    seq: zSafePosInt,
    method_id: zUuid,
    method_code: z.string().min(1).max(40),
    method_name: z.string().min(1).max(80),
    method_kind: z.enum(PAYMENT_METHOD_KIND),
    amount_applied: zMoneyPositive,
    reference: z.string().max(60).nullable(),
  })
  .strict()

export const FinalizeCreditNotePayloadV1 = z
  .object({
    credit_note: CreditNoteHeaderV1Schema,
    lines: z.array(CreditNoteLineV1Schema).min(1).max(200),
    refunds: z.array(CreditNoteRefundV1Schema).min(1).max(5),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const lineNos = new Set<number>()
    payload.lines.forEach((line, idx) => {
      if (lineNos.has(line.line_no)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', idx, 'line_no'],
          message: `Duplicate line_no: ${line.line_no}`,
        })
      }
      lineNos.add(line.line_no)
    })

    const refundSeqs = new Set<number>()
    payload.refunds.forEach((refund, idx) => {
      if (refundSeqs.has(refund.seq)) {
        ctx.addIssue({
          code: 'custom',
          path: ['refunds', idx, 'seq'],
          message: `Duplicate refund seq: ${refund.seq}`,
        })
      }
      refundSeqs.add(refund.seq)
    })
  })

export type FinalizeCreditNotePayloadV1 = z.infer<typeof FinalizeCreditNotePayloadV1>
export type CreditNoteHeaderV1 = z.infer<typeof CreditNoteHeaderV1Schema>
export type CreditNoteLineV1 = z.infer<typeof CreditNoteLineV1Schema>
export type CreditNoteRefundV1 = z.infer<typeof CreditNoteRefundV1Schema>
