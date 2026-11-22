import '@tanstack/react-start/server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { FinalizeSalePayloadV1 } from '~/lib/contracts'
import type { CommandContext } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { creditNote, sale, saleLine, salePayment } from './schema'

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

export async function findSaleForVoid(
  tx: TenantTx,
  tenantId: string,
  saleId: string,
): Promise<{ id: string; registerId: string; shiftId: string; status: string } | null> {
  const rows = await tx
    .select({
      id: sale.id,
      registerId: sale.registerId,
      shiftId: sale.shiftId,
      status: sale.status,
    })
    .from(sale)
    .where(and(eq(sale.tenantId, tenantId), eq(sale.id, saleId)))
    .limit(1)
  return rows[0] ?? null
}

export async function hasCreditNoteForSale(
  tx: TenantTx,
  tenantId: string,
  saleId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: creditNote.id })
    .from(creditNote)
    .where(and(eq(creditNote.tenantId, tenantId), eq(creditNote.originalSaleId, saleId)))
    .limit(1)
  return rows.length > 0
}

export async function markSaleVoided(
  tx: TenantTx,
  params: {
    tenantId: string
    saleId: string
    voidedAt: string
    voidedBy: string
    voidApprovedBy: string
    voidReasonCode: string
    voidReasonText: string
    voidCommandId: string
  },
): Promise<void> {
  await tx
    .update(sale)
    .set({
      status: 'VOID',
      voidedAt: params.voidedAt,
      voidedBy: params.voidedBy,
      voidApprovedBy: params.voidApprovedBy,
      voidReasonCode: params.voidReasonCode,
      voidReasonText: params.voidReasonText,
      voidCommandId: params.voidCommandId,
    })
    .where(and(eq(sale.tenantId, params.tenantId), eq(sale.id, params.saleId)))
}

/**
 * Sums authoritative cash receipts (PAID sales only) and cash refunds for a cashier shift.
 */
export async function getShiftCashSalesAndRefundTotals(
  tx: TenantTx,
  shiftId: string,
): Promise<{ cashSales: number; cashRefund: number }> {
  const salesRes = await tx.execute(
    sql`SELECT COALESCE(SUM(sp.amount_applied), 0)::bigint AS cash_sales
        FROM sale_payment sp
        JOIN sale s
          ON s.tenant_id = sp.tenant_id
         AND s.id = sp.sale_id
        WHERE sp.shift_id = ${shiftId}::uuid
          AND sp.method_kind = 'CASH'
          AND s.status = 'PAID'`,
  )
  const refundRes = await tx.execute(
    sql`SELECT COALESCE(SUM(cnr.amount_applied), 0)::bigint AS cash_refund
        FROM credit_note_refund cnr
        WHERE cnr.shift_id = ${shiftId}::uuid
          AND cnr.method_kind = 'CASH'`,
  )
  return {
    cashSales: Number((salesRes.rows[0] as { cash_sales?: unknown } | undefined)?.cash_sales ?? 0),
    cashRefund: Number(
      (refundRes.rows[0] as { cash_refund?: unknown } | undefined)?.cash_refund ?? 0,
    ),
  }
}

/**
 * Writes the server-computed COGS: `sale.cost_total` and `sale_line.cost_snapshot` (set-based).
 * Lines without a cost (not tracked) are left NULL.
 */
export async function persistSaleCosts(
  tx: TenantTx,
  params: {
    tenantId: string
    saleId: string
    costTotal: number | null
    lines: readonly { lineId: string; costSnapshot: number | null }[]
  },
): Promise<void> {
  const tracked = params.lines.filter((l) => l.costSnapshot !== null)
  if (params.costTotal !== null) {
    await tx
      .update(sale)
      .set({ costTotal: params.costTotal })
      .where(and(eq(sale.tenantId, params.tenantId), eq(sale.id, params.saleId)))
  }
  if (tracked.length === 0) return
  await tx.execute(sql`
    UPDATE sale_line AS sl
    SET cost_snapshot = v.cost
    FROM (VALUES ${sql.join(
      tracked.map((l) => sql`(${l.lineId}::uuid, ${l.costSnapshot}::bigint)`),
      sql`, `,
    )}) AS v(id, cost)
    WHERE sl.tenant_id = ${params.tenantId}::uuid AND sl.id = v.id
  `)
}

export interface SaleStockLineRow {
  readonly lineId: string
  readonly lineNo: number
  readonly skuId: string | null
  readonly lineKind: string
  readonly qtyBase: string
  readonly costSnapshot: number | null
  readonly returnedQtyBase: string
  readonly returnedCost: number
}

/** Stock context of a sale: outlet, business date, and its lines with their KEMBALI_STOK return totals. */
export async function loadSaleStockContext(
  tx: TenantTx,
  tenantId: string,
  saleId: string,
): Promise<{ outletId: string; businessDate: string; lines: SaleStockLineRow[] } | null> {
  const head = await tx.execute<{ outlet_id: string; business_date: string }>(sql`
    SELECT outlet_id, business_date::text AS business_date
    FROM sale WHERE tenant_id = ${tenantId}::uuid AND id = ${saleId}::uuid
  `)
  const h = head.rows[0]
  if (!h) return null
  const rows = await tx.execute<{
    id: string
    line_no: number
    sku_id: string | null
    line_kind: string
    qty_base: string
    cost_snapshot: string | number | null
    returned_qty: string
    returned_cost: string | number
  }>(sql`
    SELECT sl.id, sl.line_no, sl.sku_id, sl.line_kind, sl.qty_base::text AS qty_base, sl.cost_snapshot,
           COALESCE(SUM(cl.qty_returned_base) FILTER (WHERE cl.disposition = 'KEMBALI_STOK'), 0)::text AS returned_qty,
           COALESCE(SUM(cl.cost_returned) FILTER (WHERE cl.disposition = 'KEMBALI_STOK'), 0)::bigint AS returned_cost
    FROM sale_line sl
    LEFT JOIN credit_note_line cl ON cl.tenant_id = sl.tenant_id AND cl.sale_line_id = sl.id
    WHERE sl.tenant_id = ${tenantId}::uuid AND sl.sale_id = ${saleId}::uuid
    GROUP BY sl.id
    ORDER BY sl.line_no
  `)
  return {
    outletId: h.outlet_id,
    businessDate: h.business_date,
    lines: rows.rows.map((r) => ({
      lineId: r.id,
      lineNo: r.line_no,
      skuId: r.sku_id,
      lineKind: r.line_kind,
      qtyBase: r.qty_base,
      costSnapshot: r.cost_snapshot === null ? null : Number(r.cost_snapshot),
      returnedQtyBase: r.returned_qty,
      returnedCost: Number(r.returned_cost),
    })),
  }
}

/** KEMBALI_STOK return totals per sale line (used by returns for `returned_before`). */
export async function loadReturnedTotals(
  tx: TenantTx,
  tenantId: string,
  saleLineIds: readonly string[],
): Promise<Map<string, { qty: string; cost: number }>> {
  const out = new Map<string, { qty: string; cost: number }>()
  if (saleLineIds.length === 0) return out
  const res = await tx.execute<{ sale_line_id: string; qty: string; cost: string | number }>(sql`
    SELECT cl.sale_line_id, SUM(cl.qty_returned_base)::text AS qty, COALESCE(SUM(cl.cost_returned), 0)::bigint AS cost
    FROM credit_note_line cl
    WHERE cl.tenant_id = ${tenantId}::uuid
      AND cl.disposition = 'KEMBALI_STOK'
      AND cl.sale_line_id IN (${sql.join(saleLineIds.map((id) => sql`${id}::uuid`), sql`, `)})
    GROUP BY cl.sale_line_id
  `)
  for (const r of res.rows) out.set(r.sale_line_id, { qty: r.qty, cost: Number(r.cost) })
  return out
}
