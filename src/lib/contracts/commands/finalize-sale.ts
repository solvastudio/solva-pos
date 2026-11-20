import { z } from 'zod'
import {
  DISCOUNT_TYPE,
  PAYMENT_METHOD_KIND,
  PRICE_SOURCE,
  PRICE_TAX_MODE,
  SALE_LINE_KIND,
  TAX_PROFILE,
} from '../enums'
import {
  zBusinessDate,
  zCashRoundingUnit,
  zCurrencyIdr,
  zIso,
  zMoney,
  zMoneyNonNeg,
  zMoneyPositive,
  zPercent,
  zPeriod,
  zQtyPositive,
  zReceiptLocale,
  zSafeNonNegInt,
  zSafePosInt,
  zUuid,
} from '../primitives'

export const SaleHeaderV1Schema = z
  .object({
    id: zUuid,
    shift_id: zUuid,
    created_by: zUuid,
    created_at_device: zIso,
    clock_offset_ms: zMoney,
    occurred_at: zIso,
    business_date: zBusinessDate,
    invoice_no: z.string().min(1).max(40),
    invoice_prefix: z.string().min(2).max(16),
    invoice_period: zPeriod,
    invoice_seq: zSafePosInt,
    legal_entity_id: zUuid,
    legal_entity_npwp: z.string().max(40).nullable(),
    legal_entity_is_pkp: z.boolean(),
    price_tax_mode: z.enum(PRICE_TAX_MODE),
    tax_profile: z.enum(TAX_PROFILE),
    tax_rate: zPercent,
    tax_rate_id: zUuid.nullable(),
    service_charge_rate: zPercent,
    service_charge_taxable: z.boolean(),
    cash_rounding_unit: zCashRoundingUnit,
    receipt_locale: zReceiptLocale,
    currency: zCurrencyIdr,
    gross_total: zMoneyNonNeg,
    line_discount_total: zMoneyNonNeg,
    bill_discount_type: z.enum(DISCOUNT_TYPE).nullable(),
    bill_discount_pct: zPercent.nullable(),
    bill_discount_input: zMoneyNonNeg.nullable(),
    bill_discount_total: zMoneyNonNeg,
    discount_approved_by: zUuid.nullable(),
    net_subtotal: zMoneyNonNeg,
    service_charge: zMoneyNonNeg,
    tax_base: zMoneyNonNeg,
    tax_amount: zMoneyNonNeg,
    dpp: zMoneyNonNeg,
    grand_total: zMoneyNonNeg,
    rounding: zMoney,
    customer_name: z.string().max(80).nullable(),
    customer_phone: z.string().max(20).nullable(),
    catalog_cursor: zSafeNonNegInt.nullable(),
    bill_id: zUuid.nullable(),
    bill_ref: z.string().max(40).nullable(),
  })
  .strict()

export const SaleLineV1Schema = z
  .object({
    id: zUuid,
    line_no: zSafePosInt,
    line_kind: z.enum(SALE_LINE_KIND),
    product_id: zUuid.nullable(),
    sku_id: zUuid.nullable(),
    uom_id: zUuid.nullable(),
    sku_code: z.string().min(1).max(64),
    item_name: z.string().min(1).max(200),
    uom_code: z.string().min(1).max(32),
    qty: zQtyPositive,
    conversion_factor: zQtyPositive,
    qty_base: zQtyPositive,
    unit_price: zMoneyNonNeg,
    price_source: z.enum(PRICE_SOURCE),
    is_open_price: z.boolean(),
    taxable: z.boolean(),
    discount_type: z.enum(DISCOUNT_TYPE).nullable(),
    discount_pct: zPercent.nullable(),
    discount_input: zMoneyNonNeg.nullable(),
    discount_approved_by: zUuid.nullable(),
    line_gross: zMoneyNonNeg,
    line_discount: zMoneyNonNeg,
    line_net: zMoneyNonNeg,
    bill_discount_alloc: zMoneyNonNeg,
    service_alloc: zMoneyNonNeg,
    tax_alloc: zMoneyNonNeg,
    note: z.string().max(200).nullable(),
    source_bill_item_id: zUuid.nullable(),
    // Modifiers are F&B-optional and default to [] so v1 payloads remain backwards compatible in Phase 56.
    modifiers: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  })
  .strict()
  .superRefine((line, ctx) => {
    if (line.line_kind !== 'SHARE') {
      if (line.sku_id === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['sku_id'],
          message: 'sku_id is required unless line_kind is SHARE',
        })
      }
      if (line.uom_id === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['uom_id'],
          message: 'uom_id is required unless line_kind is SHARE',
        })
      }
    }

    if (line.price_source === 'OPEN_PRICE') {
      if (!line.is_open_price) {
        ctx.addIssue({
          code: 'custom',
          path: ['is_open_price'],
          message: 'is_open_price must be true when price_source is OPEN_PRICE',
        })
      }
      if (line.unit_price <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['unit_price'],
          message: 'unit_price must be positive for OPEN_PRICE',
        })
      }
    }

    if (line.discount_type === null) {
      if (line.discount_pct !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['discount_pct'],
          message: 'discount_pct must be null when discount_type is null',
        })
      }
      if (line.discount_input !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['discount_input'],
          message: 'discount_input must be null when discount_type is null',
        })
      }
    }

    if (line.line_kind === 'STOCK_BASIS') {
      const zeroFields: Array<keyof typeof line> = [
        'unit_price',
        'line_gross',
        'line_discount',
        'line_net',
        'bill_discount_alloc',
        'service_alloc',
        'tax_alloc',
      ]
      for (const field of zeroFields) {
        if (line[field] !== 0) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} must be 0 when line_kind is STOCK_BASIS`,
          })
        }
      }
    }
  })

export const SalePaymentV1Schema = z
  .object({
    id: zUuid,
    seq: zSafePosInt,
    method_id: zUuid,
    method_code: z.string().min(1).max(40),
    method_name: z.string().min(1).max(80),
    method_kind: z.enum(PAYMENT_METHOD_KIND),
    amount_applied: zMoneyPositive,
    cash_tendered: zMoneyNonNeg.nullable(),
    change_given: zMoneyNonNeg.nullable(),
    reference: z.string().max(60).nullable(),
    is_rounding_settler: z.boolean(),
  })
  .strict()
  .superRefine((pay, ctx) => {
    if (pay.method_kind === 'CASH') {
      if (pay.cash_tendered === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['cash_tendered'],
          message: 'cash_tendered is required for CASH payment',
        })
      }
      if (pay.change_given === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['change_given'],
          message: 'change_given is required for CASH payment',
        })
      }
    } else {
      if (pay.cash_tendered !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['cash_tendered'],
          message: 'cash_tendered must be null for NON_CASH payment',
        })
      }
      if (pay.change_given !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['change_given'],
          message: 'change_given must be null for NON_CASH payment',
        })
      }
      if (pay.is_rounding_settler) {
        ctx.addIssue({
          code: 'custom',
          path: ['is_rounding_settler'],
          message: 'is_rounding_settler can only be true for CASH payment',
        })
      }
    }
  })

export const FinalizeSalePayloadV1 = z
  .object({
    sale: SaleHeaderV1Schema,
    lines: z.array(SaleLineV1Schema).min(1).max(200),
    payments: z.array(SalePaymentV1Schema).min(1).max(10),
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

    const paymentSeqs = new Set<number>()
    payload.payments.forEach((pay, idx) => {
      if (paymentSeqs.has(pay.seq)) {
        ctx.addIssue({
          code: 'custom',
          path: ['payments', idx, 'seq'],
          message: `Duplicate payment seq: ${pay.seq}`,
        })
      }
      paymentSeqs.add(pay.seq)
    })
  })

export type FinalizeSalePayloadV1 = z.infer<typeof FinalizeSalePayloadV1>
export type SaleHeaderV1 = z.infer<typeof SaleHeaderV1Schema>
export type SaleLineV1 = z.infer<typeof SaleLineV1Schema>
export type SalePaymentV1 = z.infer<typeof SalePaymentV1Schema>
