import '@tanstack/react-start/server-only'
import type { FinalizeSalePayloadV1 } from '~/lib/contracts'
import type { CommandContext } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { sale, saleLine, salePayment } from './schema'

export async function insertSaleFacts(
  tx: TenantTx,
  params: {
    ctx: CommandContext
    payload: FinalizeSalePayloadV1
    finalInvoiceNo: string
    invoiceConflictIdx: number
  },
): Promise<void> {
  const { ctx, payload, finalInvoiceNo, invoiceConflictIdx } = params
  const s = payload.sale

  await tx.insert(sale).values({
    id: s.id,
    tenantId: ctx.device.tenantId,
    outletId: ctx.device.outletId,
    registerId: ctx.device.registerId,
    deviceId: ctx.device.deviceId,
    createdBy: s.created_by,
    createdAtDevice: s.created_at_device,
    clockOffsetMs: s.clock_offset_ms,
    occurredAt: s.occurred_at,
    businessDate: s.business_date,
    receivedAt: ctx.receivedAtIso,
    commandId: ctx.commandId,
    schemaVersion: ctx.schemaVersion,
    appVersion: ctx.appVersion,
    invoiceNo: finalInvoiceNo,
    invoicePrefix: s.invoice_prefix,
    invoicePeriod: s.invoice_period,
    invoiceSeq: s.invoice_seq,
    invoiceConflictIdx,
    shiftId: s.shift_id,
    legalEntityId: s.legal_entity_id,
    status: 'PAID',
    billId: s.bill_id,
    billRef: s.bill_ref,
    priceTaxMode: s.price_tax_mode,
    taxProfile: s.tax_profile,
    taxRate: s.tax_rate,
    serviceChargeRate: s.service_charge_rate,
    serviceChargeTaxable: s.service_charge_taxable,
    cashRoundingUnit: s.cash_rounding_unit,
    taxRateId: s.tax_rate_id,
    receiptLocale: s.receipt_locale,
    legalEntityNpwp: s.legal_entity_npwp,
    legalEntityIsPkp: s.legal_entity_is_pkp,
    currency: s.currency,
    grossTotal: s.gross_total,
    lineDiscountTotal: s.line_discount_total,
    billDiscountType: s.bill_discount_type,
    billDiscountPct: s.bill_discount_pct,
    billDiscountInput: s.bill_discount_input,
    billDiscountTotal: s.bill_discount_total,
    discountApprovedBy: s.discount_approved_by,
    netSubtotal: s.net_subtotal,
    serviceCharge: s.service_charge,
    taxBase: s.tax_base,
    taxAmount: s.tax_amount,
    dpp: s.dpp,
    grandTotal: s.grand_total,
    rounding: s.rounding,
    customerName: s.customer_name,
    customerPhone: s.customer_phone,
    catalogCursor: s.catalog_cursor,
  })

  await tx.insert(saleLine).values(
    payload.lines.map((l) => ({
      id: l.id,
      tenantId: ctx.device.tenantId,
      saleId: s.id,
      outletId: ctx.device.outletId,
      businessDate: s.business_date,
      lineNo: l.line_no,
      lineKind: l.line_kind,
      productId: l.product_id,
      skuId: l.sku_id,
      uomId: l.uom_id,
      skuCode: l.sku_code,
      itemName: l.item_name,
      uomCode: l.uom_code,
      qty: l.qty,
      conversionFactor: l.conversion_factor,
      qtyBase: l.qty_base,
      unitPrice: l.unit_price,
      priceSource: l.price_source,
      isOpenPrice: l.is_open_price,
      taxable: l.taxable,
      discountType: l.discount_type,
      discountPct: l.discount_pct,
      discountInput: l.discount_input,
      discountApprovedBy: l.discount_approved_by,
      lineGross: l.line_gross,
      lineDiscount: l.line_discount,
      lineNet: l.line_net,
      billDiscountAlloc: l.bill_discount_alloc,
      serviceAlloc: l.service_alloc,
      taxAlloc: l.tax_alloc,
      note: l.note,
      sourceBillItemId: l.source_bill_item_id,
    })),
  )

  await tx.insert(salePayment).values(
    payload.payments.map((p) => ({
      id: p.id,
      tenantId: ctx.device.tenantId,
      saleId: s.id,
      shiftId: s.shift_id,
      outletId: ctx.device.outletId,
      businessDate: s.business_date,
      seq: p.seq,
      methodId: p.method_id,
      methodCode: p.method_code,
      methodName: p.method_name,
      methodKind: p.method_kind,
      amountApplied: p.amount_applied,
      cashTendered: p.cash_tendered,
      changeGiven: p.change_given,
      reference: p.reference,
      isRoundingSettler: p.is_rounding_settler,
    })),
  )
}
