import '@tanstack/react-start/server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { FinalizeCreditNotePayloadV1 } from '~/lib/contracts'
import type { CommandContext } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { creditNote, creditNoteLine, creditNoteRefund, sale } from './schema'

export interface LockedSaleLineForReturn {
  readonly id: string
  readonly saleId: string
  readonly lineKind: string
  readonly qty: string
  readonly lineNet: number
  readonly billDiscountAlloc: number
  readonly serviceAlloc: number
  readonly taxAlloc: number
}

export interface PriorReturnSums {
  readonly qtyReturnedSum: string
  readonly netSum: number
  readonly scSum: number
  readonly taxSum: number
}

export async function findOriginalSaleForCreditNote(
  tx: TenantTx,
  tenantId: string,
  saleId: string,
): Promise<{ id: string; businessDate: string; status: string } | null> {
  const rows = await tx
    .select({
      id: sale.id,
      businessDate: sale.businessDate,
      status: sale.status,
    })
    .from(sale)
    .where(and(eq(sale.tenantId, tenantId), eq(sale.id, saleId)))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Locks all referenced `sale_line` rows in ascending ID order (`FOR UPDATE`) so parallel
 * partial returns serialize cleanly without deadlocks (BR-RTR-009).
 */
export async function lockSaleLinesOrderedForUpdate(
  tx: TenantTx,
  tenantId: string,
  saleLineIds: readonly string[],
): Promise<Map<string, LockedSaleLineForReturn>> {
  const sortedIds = [...new Set(saleLineIds)].sort()
  const out = new Map<string, LockedSaleLineForReturn>()
  if (sortedIds.length === 0) return out

  const arrayLiteral = `{${sortedIds.join(',')}}`
  const res = await tx.execute(
    sql`SELECT id, sale_id, line_kind, qty, line_net, bill_discount_alloc, service_alloc, tax_alloc
        FROM sale_line
        WHERE tenant_id = ${tenantId}::uuid
          AND id = ANY(${arrayLiteral}::uuid[])
        ORDER BY id ASC
        FOR UPDATE`,
  )

  for (const row of res.rows as Array<Record<string, unknown>>) {
    const id = String(row.id)
    out.set(id, {
      id,
      saleId: String(row.sale_id),
      lineKind: String(row.line_kind),
      qty: String(row.qty),
      lineNet: Number(row.line_net),
      billDiscountAlloc: Number(row.bill_discount_alloc),
      serviceAlloc: Number(row.service_alloc),
      taxAlloc: Number(row.tax_alloc),
    })
  }
  return out
}

export async function sumPriorCreditNoteReturns(
  tx: TenantTx,
  tenantId: string,
  saleLineIds: readonly string[],
): Promise<Map<string, PriorReturnSums>> {
  const uniqueIds = [...new Set(saleLineIds)]
  const out = new Map<string, PriorReturnSums>()
  if (uniqueIds.length === 0) return out

  const arrayLiteral = `{${uniqueIds.join(',')}}`
  const res = await tx.execute(
    sql`SELECT
          sale_line_id,
          COALESCE(SUM(qty_returned), 0)::text AS qty_sum,
          COALESCE(SUM(refund_net), 0)::bigint AS net_sum,
          COALESCE(SUM(refund_service), 0)::bigint AS sc_sum,
          COALESCE(SUM(refund_tax), 0)::bigint AS tax_sum
        FROM credit_note_line
        WHERE tenant_id = ${tenantId}::uuid
          AND sale_line_id = ANY(${arrayLiteral}::uuid[])
        GROUP BY sale_line_id`,
  )

  for (const row of res.rows as Array<Record<string, unknown>>) {
    out.set(String(row.sale_line_id), {
      qtyReturnedSum: String(row.qty_sum),
      netSum: Number(row.net_sum),
      scSum: Number(row.sc_sum),
      taxSum: Number(row.tax_sum),
    })
  }
  return out
}

export async function insertCreditNoteFacts(
  tx: TenantTx,
  params: {
    ctx: CommandContext
    payload: FinalizeCreditNotePayloadV1
    finalCnNo: string
    cnConflictIdx: number
  },
): Promise<void> {
  const { ctx, payload, finalCnNo, cnConflictIdx } = params
  const cn = payload.credit_note

  await tx.insert(creditNote).values({
    id: cn.id,
    tenantId: ctx.device.tenantId,
    outletId: ctx.device.outletId,
    registerId: ctx.device.registerId,
    deviceId: ctx.device.deviceId,
    createdBy: cn.created_by,
    createdAtDevice: cn.created_at_device,
    clockOffsetMs: cn.clock_offset_ms,
    occurredAt: cn.occurred_at,
    businessDate: cn.business_date,
    receivedAt: ctx.receivedAtIso,
    commandId: ctx.commandId,
    schemaVersion: ctx.schemaVersion,
    appVersion: ctx.appVersion,
    cnNo: finalCnNo,
    cnPrefix: cn.cn_prefix,
    cnPeriod: cn.cn_period,
    cnSeq: cn.cn_seq,
    cnConflictIdx,
    originalSaleId: cn.original_sale_id,
    originalInvoiceNo: cn.original_invoice_no,
    shiftId: cn.shift_id,
    status: 'POSTED',
    reasonCode: cn.reason_code,
    reasonText: cn.reason_text,
    approvedBy: cn.approved_by,
    priceTaxMode: cn.price_tax_mode,
    cashRoundingUnit: cn.cash_rounding_unit,
    receiptLocale: cn.receipt_locale,
    netTotal: cn.net_total,
    serviceTotal: cn.service_total,
    taxTotal: cn.tax_total,
    refundGross: cn.refund_gross,
    rounding: cn.rounding,
  })

  await tx.insert(creditNoteLine).values(
    payload.lines.map((l) => ({
      id: l.id,
      tenantId: ctx.device.tenantId,
      creditNoteId: cn.id,
      saleLineId: l.sale_line_id,
      outletId: ctx.device.outletId,
      businessDate: cn.business_date,
      lineNo: l.line_no,
      qtyReturned: l.qty_returned,
      qtyReturnedBase: l.qty_returned_base,
      refundNet: l.refund_net,
      refundService: l.refund_service,
      refundTax: l.refund_tax,
      isFinalReturn: l.is_final_return,
      disposition: l.disposition,
    })),
  )

  await tx.insert(creditNoteRefund).values(
    payload.refunds.map((r) => ({
      id: r.id,
      tenantId: ctx.device.tenantId,
      creditNoteId: cn.id,
      shiftId: cn.shift_id,
      seq: r.seq,
      methodId: r.method_id,
      methodCode: r.method_code,
      methodName: r.method_name,
      methodKind: r.method_kind,
      amountApplied: r.amount_applied,
      reference: r.reference,
    })),
  )
}

export interface SaleLineStockInfo {
  readonly saleLineId: string
  readonly lineNo: number
  readonly skuId: string | null
  readonly qtyBase: string
  readonly costSnapshot: number | null
}

/** Info stok baris penjualan asal untuk retur (SKU, qty base, cost_snapshot). */
export async function loadSaleLineStockInfo(
  tx: TenantTx,
  tenantId: string,
  saleLineIds: readonly string[],
): Promise<Map<string, SaleLineStockInfo>> {
  const out = new Map<string, SaleLineStockInfo>()
  if (saleLineIds.length === 0) return out
  const res = await tx.execute<{
    id: string
    line_no: number
    sku_id: string | null
    qty_base: string
    cost_snapshot: string | number | null
  }>(sql`
    SELECT id, line_no, sku_id, qty_base::text AS qty_base, cost_snapshot
    FROM sale_line
    WHERE tenant_id = ${tenantId}::uuid
      AND id IN (${sql.join(saleLineIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)
  for (const r of res.rows) {
    out.set(r.id, {
      saleLineId: r.id,
      lineNo: r.line_no,
      skuId: r.sku_id,
      qtyBase: r.qty_base,
      costSnapshot: r.cost_snapshot === null ? null : Number(r.cost_snapshot),
    })
  }
  return out
}

/** Menulis `credit_note_line.cost_returned` (set-based). NULL untuk disposisi tanpa HPP kembali. */
export async function persistCreditNoteCosts(
  tx: TenantTx,
  tenantId: string,
  lines: readonly { creditNoteLineId: string; costReturned: number | null }[],
): Promise<void> {
  const tracked = lines.filter((l) => l.costReturned !== null)
  if (tracked.length === 0) return
  await tx.execute(sql`
    UPDATE credit_note_line AS cl
    SET cost_returned = v.cost
    FROM (VALUES ${sql.join(
      tracked.map((l) => sql`(${l.creditNoteLineId}::uuid, ${l.costReturned}::bigint)`),
      sql`, `,
    )}) AS v(id, cost)
    WHERE cl.tenant_id = ${tenantId}::uuid AND cl.id = v.id
  `)
}
