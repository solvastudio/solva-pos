import { z } from 'zod'
import {
  PAYMENT_METHOD_KIND,
  PRICE_TAX_MODE,
  RETURN_DISPOSITION,
  SALE_LINE_KIND,
  SALE_STATUS,
} from './enums'
import {
  zBusinessDate,
  zCashRoundingUnit,
  zMoneyNonNeg,
  zQty,
  zQtyPositive,
  zReceiptLocale,
  zSafePosInt,
  zUuid,
} from './primitives'

export const InvoiceLookupReturnedSoFarSchema = z
  .object({
    qty: zQty,
    net: zMoneyNonNeg,
    sc: zMoneyNonNeg,
    tax: zMoneyNonNeg,
  })
  .strict()

export const InvoiceLookupLineSchema = z
  .object({
    id: zUuid,
    line_no: zSafePosInt,
    line_kind: z.enum(SALE_LINE_KIND),
    sku_id: zUuid.nullable(),
    uom_id: zUuid.nullable(),
    item_name: z.string().min(1).max(200),
    uom_code: z.string().min(1).max(32),
    qty: zQtyPositive,
    conversion_factor: zQtyPositive,
    unit_price: zMoneyNonNeg,
    line_net: zMoneyNonNeg,
    bill_discount_alloc: zMoneyNonNeg,
    service_alloc: zMoneyNonNeg,
    tax_alloc: zMoneyNonNeg,
    disposition_default: z.enum(RETURN_DISPOSITION),
    returned_so_far: InvoiceLookupReturnedSoFarSchema,
  })
  .strict()

export const InvoiceLookupPaymentSummarySchema = z
  .object({
    method_id: zUuid,
    method_code: z.string().min(1).max(40),
    method_name: z.string().min(1).max(80),
    method_kind: z.enum(PAYMENT_METHOD_KIND),
    amount_applied: zMoneyNonNeg,
  })
  .strict()

export const InvoiceLookupSaleSchema = z
  .object({
    id: zUuid,
    outlet_id: zUuid,
    register_id: zUuid,
    invoice_no: z.string().min(1).max(40),
    business_date: zBusinessDate,
    status: z.enum(SALE_STATUS),
    price_tax_mode: z.enum(PRICE_TAX_MODE),
    cash_rounding_unit: zCashRoundingUnit,
    receipt_locale: zReceiptLocale,
    grand_total: zMoneyNonNeg,
    payments: z.array(InvoiceLookupPaymentSummarySchema),
  })
  .strict()

export const InvoiceLookupResponseSchema = z
  .object({
    sale: InvoiceLookupSaleSchema,
    lines: z.array(InvoiceLookupLineSchema),
  })
  .strict()

export type InvoiceLookupResponse = z.infer<typeof InvoiceLookupResponseSchema>
export type InvoiceLookupLine = z.infer<typeof InvoiceLookupLineSchema>
export type InvoiceLookupSale = z.infer<typeof InvoiceLookupSaleSchema>
