import {
  parseCommandPayload,
  SCHEMA_VERSION,
  type FinalizeSalePayloadV1,
} from '~/lib/contracts'
import { toMoney, type Money } from '~/lib/kernel'
import {
  calcAndSettle,
  verifySale,
  type PaymentInput,
  type VerifyResult,
} from '~/lib/sales-calc'
import type { SaleLineRecord, SalePaymentRecord, SaleRecord } from '../db/types'
import { toCalcInput, type CartState } from './cart'

export interface DetailedPaymentEntry {
  methodId: string
  methodCode: string
  methodName: string
  kind: 'CASH' | 'NON_CASH'
  amount: Money
  reference?: string | null
}

export interface BuildFinalizeSaleInput {
  cart: CartState
  payments: readonly DetailedPaymentEntry[]
  saleId: string
  lineIds: readonly string[]
  paymentIds: readonly string[]
  invoice: {
    invoiceNo: string
    prefix: string
    period: string
    seq: number
  }
  deviceMeta: {
    tenantId: string
    outletId: string
    registerId: string
    deviceId: string
    shiftId: string
    staffId: string
    createdAtDevice: string
    occurredAt: string
    businessDate: string
    clockOffsetMs: number
    catalogCursor: number | null
  }
  outletMeta: {
    legalEntityId: string
    legalEntityNpwp: string | null
    legalEntityIsPkp: boolean
    receiptLocale: 'id-ID' | 'en-US'
  }
  billDiscountApprovedBy?: string | null
}

export interface BuiltFinalizeSale {
  payload: FinalizeSalePayloadV1
  verifyResult: VerifyResult
  saleRecord: SaleRecord
  lineRecords: SaleLineRecord[]
  paymentRecords: SalePaymentRecord[]
}

/**
 * Purely builds & verifies `FinalizeSalePayloadV1` plus local Dexie `sale`/`sale_line`/`sale_payment`
 * rows using one single `calcAndSettle` computation (BR-MNY-003, AD-14 Tahap A).
 */
export function buildFinalizeSalePayload(input: BuildFinalizeSaleInput): BuiltFinalizeSale {
  const { cart, payments: payEntries } = input
  if (input.lineIds.length !== cart.lines.length) {
    throw new Error('lineIds length mismatch')
  }
  if (input.paymentIds.length !== payEntries.length) {
    throw new Error('paymentIds length mismatch')
  }

  const calcInput = toCalcInput(cart)
  const rawPayments: PaymentInput[] = payEntries.map((p) => ({
    methodCode: p.methodCode,
    kind: p.kind,
    amount: p.amount,
    reference: p.reference ?? null,
  }))

  const { calc, settlement } = calcAndSettle(calcInput, rawPayments, cart.cashRoundingUnit)

  const billDiscType = cart.billDiscount?.type ?? null
  const billDiscPct =
    billDiscType === 'PERCENT' ? (cart.billDiscount?.pct ?? null) : null
  const billDiscInput =
    billDiscType === 'NOMINAL' ? (cart.billDiscount?.input ?? null) : null
  const billApprovedBy =
    input.billDiscountApprovedBy ?? cart.billDiscount?.approvedBy ?? null

  const saleHeader: FinalizeSalePayloadV1['sale'] = {
    id: input.saleId,
    shift_id: input.deviceMeta.shiftId,
    created_by: input.deviceMeta.staffId,
    created_at_device: input.deviceMeta.createdAtDevice,
    clock_offset_ms: input.deviceMeta.clockOffsetMs,
    occurred_at: input.deviceMeta.occurredAt,
    business_date: input.deviceMeta.businessDate,
    invoice_no: input.invoice.invoiceNo,
    invoice_prefix: input.invoice.prefix,
    invoice_period: input.invoice.period,
    invoice_seq: input.invoice.seq,
    legal_entity_id: input.outletMeta.legalEntityId,
    legal_entity_npwp: input.outletMeta.legalEntityNpwp,
    legal_entity_is_pkp: input.outletMeta.legalEntityIsPkp,
    price_tax_mode: cart.config.priceTaxMode,
    tax_profile: cart.config.taxProfile,
    tax_rate: cart.config.taxRate,
    tax_rate_id: cart.taxRateId,
    service_charge_rate: cart.config.serviceChargeEnabled
      ? cart.config.serviceChargeRate
      : '0',
    service_charge_taxable: cart.config.serviceChargeTaxable,
    cash_rounding_unit: cart.cashRoundingUnit,
    receipt_locale: input.outletMeta.receiptLocale,
    currency: 'IDR',
    gross_total: calc.grossTotal,
    line_discount_total: calc.lineDiscountTotal,
    bill_discount_type: billDiscType,
    bill_discount_pct: billDiscPct,
    bill_discount_input: billDiscInput,
    bill_discount_total: calc.billDiscountTotal,
    discount_approved_by: billApprovedBy,
    net_subtotal: calc.netSubtotal,
    service_charge: calc.serviceCharge,
    tax_base: calc.taxBase,
    tax_amount: calc.taxAmount,
    dpp: calc.dpp,
    grand_total: calc.grandTotal,
    rounding: settlement.rounding,
    customer_name: cart.customer?.name ? cart.customer.name.slice(0, 80) : null,
    customer_phone: cart.customer?.phone ? cart.customer.phone.slice(0, 20) : null,
    catalog_cursor: input.deviceMeta.catalogCursor,
    bill_id: cart.billId ?? null,
    bill_ref: cart.billRef ?? null,
  }

  const linesPayload: FinalizeSalePayloadV1['lines'] = cart.lines.map((line, i) => {
    const lineCalc = calc.lines[i]!
    const dType = line.discount?.type ?? null
    return {
      id: input.lineIds[i]!,
      line_no: line.lineNo,
      line_kind: 'ITEM',
      product_id: line.productId,
      sku_id: line.skuId,
      uom_id: line.uomId,
      sku_code: line.skuCode,
      item_name: line.variantLabel ? `${line.itemName} — ${line.variantLabel}` : line.itemName,
      uom_code: line.uomCode,
      qty: line.qty,
      conversion_factor: line.conversionFactor,
      qty_base: line.qtyBase,
      unit_price: line.unitPrice,
      price_source: line.priceSource,
      is_open_price: line.isOpenPrice,
      taxable: line.taxable,
      discount_type: dType,
      discount_pct: dType === 'PERCENT' ? (line.discount?.pct ?? null) : null,
      discount_input: dType === 'NOMINAL' ? (line.discount?.input ?? null) : null,
      discount_approved_by: line.discount?.approvedBy ?? null,
      line_gross: lineCalc.lineGross,
      line_discount: lineCalc.lineDiscount,
      line_net: lineCalc.lineNet,
      bill_discount_alloc: lineCalc.billDiscountAlloc,
      service_alloc: lineCalc.serviceAlloc,
      tax_alloc: lineCalc.taxAlloc,
      note: line.note ? line.note.slice(0, 200) : null,
      source_bill_item_id: line.sourceBillItemId ?? null,
      modifiers: (line.modifiers ?? []).map((m) => ({
        modifier_id: m.modifier_id,
        name: m.name,
        price_delta: m.price_delta,
        qty: m.qty,
      })),
    }
  })

  const paymentsPayload: FinalizeSalePayloadV1['payments'] = settlement.payments.map(
    (applied, i) => {
      const src = payEntries[i]!
      const isLast = i === settlement.payments.length - 1
      const isSettler = applied.kind === 'CASH' && isLast
      return {
        id: input.paymentIds[i]!,
        seq: i + 1,
        method_id: src.methodId,
        method_code: applied.methodCode,
        method_name: src.methodName,
        method_kind: applied.kind,
        amount_applied: applied.applied,
        cash_tendered: applied.kind === 'CASH' ? applied.tendered : null,
        change_given: applied.kind === 'CASH' ? applied.change : null,
        reference: applied.reference,
        is_rounding_settler: isSettler,
      }
    },
  )

  const rawPayload: FinalizeSalePayloadV1 = {
    sale: saleHeader,
    lines: linesPayload,
    payments: paymentsPayload,
  }

  const parsedPayload = parseCommandPayload(
    'FinalizeSale',
    SCHEMA_VERSION,
    rawPayload,
  ) as FinalizeSalePayloadV1

  const verifyResult = verifySale({
    input: calcInput,
    payments: rawPayments,
    cashRoundingUnit: cart.cashRoundingUnit,
    stored: {
      grossTotal: toMoney(parsedPayload.sale.gross_total),
      lineDiscountTotal: toMoney(parsedPayload.sale.line_discount_total),
      billDiscountTotal: toMoney(parsedPayload.sale.bill_discount_total),
      netSubtotal: toMoney(parsedPayload.sale.net_subtotal),
      serviceCharge: toMoney(parsedPayload.sale.service_charge),
      taxBase: toMoney(parsedPayload.sale.tax_base),
      taxAmount: toMoney(parsedPayload.sale.tax_amount),
      dpp: toMoney(parsedPayload.sale.dpp),
      grandTotal: toMoney(parsedPayload.sale.grand_total),
      rounding: toMoney(parsedPayload.sale.rounding),
      totalDue: settlement.totalDue,
      lines: calc.lines,
    },
  })

  const saleRecord: SaleRecord = {
    ...parsedPayload.sale,
    tenant_id: input.deviceMeta.tenantId,
    outlet_id: input.deviceMeta.outletId,
    register_id: input.deviceMeta.registerId,
    device_id: input.deviceMeta.deviceId,
    status: 'PAID',
    total_due: settlement.totalDue,
    sync_status: 'PENDING',
    synced_at: null,
    server_result: null,
    print_state: 'QUEUED',
  }

  const lineRecords: SaleLineRecord[] = parsedPayload.lines.map((l) => ({
    ...l,
    sale_id: input.saleId,
  }))

  const paymentRecords: SalePaymentRecord[] = parsedPayload.payments.map((p) => ({
    ...p,
    sale_id: input.saleId,
    shift_id: input.deviceMeta.shiftId,
  }))

  return {
    payload: parsedPayload,
    verifyResult,
    saleRecord,
    lineRecords,
    paymentRecords,
  }
}
