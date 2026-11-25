import { z } from 'zod'
import { BILL_EVENT_TYPE, DISCOUNT_TYPE, PRICE_SOURCE } from '../enums'
import {
  zBusinessDate,
  zIso,
  zMoney,
  zMoneyNonNeg,
  zPercent,
  zQtyPositive,
  zSafeNonNegInt,
  zSafePosInt,
  zUuid,
} from '../primitives'

const APP_VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/

export const BillItemModifierInputSchema = z
  .object({
    modifier_id: zUuid,
    name: z.string().min(1).max(60),
    price_delta: zMoney,
    qty: z.number().int().min(1).max(32767).default(1),
  })
  .strict()

export const SaleLineModifierInputSchema = z
  .object({
    modifier_id: zUuid.nullable(),
    name: z.string().min(1).max(60),
    price_delta: zMoney,
    qty: z.number().int().min(1).max(32767).default(1),
  })
  .strict()

export const BillItemDiscountInputSchema = z
  .object({
    type: z.enum(DISCOUNT_TYPE),
    pct: zPercent.nullable().optional(),
    input: zMoneyNonNeg.nullable().optional(),
    approved_by: zUuid.nullable().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.type === 'PERCENT') {
      if (d.pct === null || d.pct === undefined) {
        ctx.addIssue({ code: 'custom', path: ['pct'], message: 'pct is required for PERCENT discount' })
      }
      if (d.input !== null && d.input !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['input'], message: 'input must be null for PERCENT discount' })
      }
    } else {
      if (d.input === null || d.input === undefined) {
        ctx.addIssue({ code: 'custom', path: ['input'], message: 'input is required for NOMINAL discount' })
      }
      if (d.pct !== null && d.pct !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['pct'], message: 'pct must be null for NOMINAL discount' })
      }
    }
  })

export const BillOpenedPayloadSchema = z
  .object({
    table_id: zUuid,
    bill_ref: z.string().min(1).max(30),
    customer_name: z.string().max(80).nullable().optional(),
    customer_phone: z.string().max(20).nullable().optional(),
  })
  .strict()

export const ItemAddedPayloadSchema = z
  .object({
    item_id: zUuid,
    line_no: zSafePosInt,
    sku_id: zUuid,
    uom_id: zUuid,
    sku_code: z.string().min(1).max(64),
    item_name: z.string().min(1).max(200),
    uom_code: z.string().min(1).max(32),
    qty: zQtyPositive,
    conversion_factor: zQtyPositive,
    unit_price: zMoneyNonNeg,
    base_unit_price: zMoneyNonNeg.optional(),
    price_source: z.enum(PRICE_SOURCE),
    is_open_price: z.boolean(),
    taxable: z.boolean(),
    discount: BillItemDiscountInputSchema.nullable().optional(),
    note: z.string().max(200).nullable().optional(),
    modifiers: z.array(BillItemModifierInputSchema).default([]),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.price_source === 'OPEN_PRICE' && !item.is_open_price) {
      ctx.addIssue({
        code: 'custom',
        path: ['is_open_price'],
        message: 'is_open_price must be true when price_source is OPEN_PRICE',
      })
    }
  })

export const ItemVoidedPayloadSchema = z
  .object({
    item_id: zUuid,
  })
  .strict()

export const ItemQtyChangedPayloadSchema = z
  .object({
    item_id: zUuid,
    qty: zQtyPositive,
  })
  .strict()

export const ModifierSetPayloadSchema = z
  .object({
    item_id: zUuid,
    modifiers: z.array(BillItemModifierInputSchema),
    unit_price: zMoneyNonNeg,
    base_unit_price: zMoneyNonNeg.optional(),
  })
  .strict()

export const CustomerSetPayloadSchema = z
  .object({
    name: z.string().max(80).nullable().optional(),
    phone: z.string().max(20).nullable().optional(),
  })
  .strict()

export const TableSetPayloadSchema = z
  .object({
    table_id: zUuid,
  })
  .strict()

export const DiscountSetPayloadSchema = z
  .object({
    item_id: zUuid.nullable().optional(),
    type: z.enum(DISCOUNT_TYPE).nullable(),
    pct: zPercent.nullable().optional(),
    input: zMoneyNonNeg.nullable().optional(),
    approved_by: zUuid.nullable().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.type === null) {
      if (d.pct !== null && d.pct !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['pct'], message: 'pct must be null when type is null' })
      }
      if (d.input !== null && d.input !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['input'], message: 'input must be null when type is null' })
      }
    } else if (d.type === 'PERCENT') {
      if (d.pct === null || d.pct === undefined) {
        ctx.addIssue({ code: 'custom', path: ['pct'], message: 'pct is required for PERCENT discount' })
      }
      if (d.input !== null && d.input !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['input'], message: 'input must be null for PERCENT discount' })
      }
    } else {
      if (d.input === null || d.input === undefined) {
        ctx.addIssue({ code: 'custom', path: ['input'], message: 'input is required for NOMINAL discount' })
      }
      if (d.pct !== null && d.pct !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['pct'], message: 'pct must be null for NOMINAL discount' })
      }
    }
  })

export const BillCanceledPayloadSchema = z.object({}).strict()
export const PrebillPrintedPayloadSchema = z.object({}).strict()
export const BillHandedOverPayloadSchema = z
  .object({
    target_register_id: zUuid.optional(),
  })
  .strict()
export const BillAcceptedPayloadSchema = z
  .object({
    handover_event_id: zUuid.optional(),
  })
  .strict()
export const BillHandoverCanceledPayloadSchema = z
  .object({
    handover_event_id: zUuid.optional(),
  })
  .strict()

export const BILL_EVENT_PAYLOAD_SCHEMAS = {
  BILL_OPENED: BillOpenedPayloadSchema,
  ITEM_ADDED: ItemAddedPayloadSchema,
  ITEM_VOIDED: ItemVoidedPayloadSchema,
  ITEM_QTY_CHANGED: ItemQtyChangedPayloadSchema,
  MODIFIER_SET: ModifierSetPayloadSchema,
  CUSTOMER_SET: CustomerSetPayloadSchema,
  TABLE_SET: TableSetPayloadSchema,
  DISCOUNT_SET: DiscountSetPayloadSchema,
  BILL_CANCELED: BillCanceledPayloadSchema,
  PREBILL_PRINTED: PrebillPrintedPayloadSchema,
  BILL_HANDED_OVER: BillHandedOverPayloadSchema,
  BILL_ACCEPTED: BillAcceptedPayloadSchema,
  BILL_HANDOVER_CANCELED: BillHandoverCanceledPayloadSchema,
  // Full split/merge payload schemas are introduced in Phase 58.
  BILL_SPLIT: z.record(z.string(), z.unknown()),
  BILL_MERGED: z.record(z.string(), z.unknown()),
} as const

export const BillEventEnvelopeV1Schema = z
  .object({
    id: zUuid,
    bill_id: zUuid,
    bill_seq: zSafePosInt,
    device_id: zUuid,
    register_id: zUuid,
    device_seq: zSafePosInt,
    staff_id: zUuid,
    event_type: z.enum(BILL_EVENT_TYPE),
    payload: z.record(z.string(), z.unknown()),
    reason_code: z.string().min(1).max(40).nullable().optional(),
    reason_text: z.string().min(1).max(200).nullable().optional(),
    origin_bill_id: zUuid.nullable().optional(),
    origin_event_ids: z.array(zUuid).nullable().optional(),
    target_register_id: zUuid.nullable().optional(),
    handover_event_id: zUuid.nullable().optional(),
    created_at_device: zIso,
    clock_offset_ms: zMoney,
    occurred_at: zIso,
    business_date: zBusinessDate,
    schema_version: zSafePosInt,
    app_version: z.string().max(30).regex(APP_VERSION_PATTERN).nullable().optional(),
  })
  .strict()
  .superRefine((evt, ctx) => {
    const schema = BILL_EVENT_PAYLOAD_SCHEMAS[evt.event_type]
    const parsed = schema.safeParse(evt.payload)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: ['payload', ...issue.path],
          message: issue.message,
        })
      }
    }

    if (evt.event_type === 'ITEM_VOIDED' && (!evt.reason_text || evt.reason_text.trim().length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason_text'],
        message: 'reason_text is required for ITEM_VOIDED',
      })
    }

    if (evt.event_type === 'BILL_HANDED_OVER') {
      const targetId = evt.target_register_id ?? (evt.payload.target_register_id as string | undefined)
      if (!targetId) {
        ctx.addIssue({
          code: 'custom',
          path: ['target_register_id'],
          message: 'target_register_id is required for BILL_HANDED_OVER',
        })
      }
    }

    if (evt.event_type === 'BILL_ACCEPTED' || evt.event_type === 'BILL_HANDOVER_CANCELED') {
      const hoId = evt.handover_event_id ?? (evt.payload.handover_event_id as string | undefined)
      if (!hoId) {
        ctx.addIssue({
          code: 'custom',
          path: ['handover_event_id'],
          message: `handover_event_id is required for ${evt.event_type}`,
        })
      }
    }
  })

export const AppendBillEventsPayloadV1 = z
  .object({
    bill_id: zUuid,
    events: z.array(BillEventEnvelopeV1Schema).min(1).max(100),
  })
  .strict()
  .superRefine((batch, ctx) => {
    for (let i = 0; i < batch.events.length; i += 1) {
      const evt = batch.events[i]!
      if (evt.bill_id !== batch.bill_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', i, 'bill_id'],
          message: 'Event bill_id must match batch bill_id',
        })
      }
      if (i > 0 && evt.bill_seq <= batch.events[i - 1]!.bill_seq) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', i, 'bill_seq'],
          message: 'Batch events must be strictly sorted by bill_seq ascending',
        })
      }
    }
  })

const OnlineHandoverBase = {
  event_id: zUuid,
  bill_id: zUuid,
  device_seq: zSafePosInt,
  staff_id: zUuid,
  client_last_event_seq: zSafeNonNegInt,
  created_at_device: zIso,
  clock_offset_ms: zMoney,
  schema_version: zSafePosInt,
  app_version: z.string().max(30).regex(APP_VERSION_PATTERN).nullable().optional(),
} as const

export const HandOverBillPayloadV1 = z
  .object({
    ...OnlineHandoverBase,
    target_register_id: zUuid,
  })
  .strict()

export const AcceptBillPayloadV1 = z
  .object({
    ...OnlineHandoverBase,
  })
  .strict()

export const CancelBillHandoverPayloadV1 = z
  .object({
    ...OnlineHandoverBase,
  })
  .strict()

export type BillItemModifierInput = z.infer<typeof BillItemModifierInputSchema>
export type SaleLineModifierInput = z.infer<typeof SaleLineModifierInputSchema>
export type BillItemDiscountInput = z.infer<typeof BillItemDiscountInputSchema>
export type BillOpenedPayload = z.infer<typeof BillOpenedPayloadSchema>
export type ItemAddedPayload = z.infer<typeof ItemAddedPayloadSchema>
export type ItemVoidedPayload = z.infer<typeof ItemVoidedPayloadSchema>
export type ItemQtyChangedPayload = z.infer<typeof ItemQtyChangedPayloadSchema>
export type ModifierSetPayload = z.infer<typeof ModifierSetPayloadSchema>
export type CustomerSetPayload = z.infer<typeof CustomerSetPayloadSchema>
export type TableSetPayload = z.infer<typeof TableSetPayloadSchema>
export type DiscountSetPayload = z.infer<typeof DiscountSetPayloadSchema>
export type BillEventEnvelopeV1 = z.infer<typeof BillEventEnvelopeV1Schema>
export type AppendBillEventsPayloadV1 = z.infer<typeof AppendBillEventsPayloadV1>
export type HandOverBillPayloadV1 = z.infer<typeof HandOverBillPayloadV1>
export type AcceptBillPayloadV1 = z.infer<typeof AcceptBillPayloadV1>
export type CancelBillHandoverPayloadV1 = z.infer<typeof CancelBillHandoverPayloadV1>
