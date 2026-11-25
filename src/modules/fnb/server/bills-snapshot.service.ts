import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type {
  BillDetailResponse,
  BillsSnapshotBlock,
  BillSnapshotItem,
  BillSnapshotModifier,
  BillSnapshotRow,
  BillSplitMode,
  BillStatus,
  DiscountType,
  PriceSource,
  BillHandoverStatus,
  BillItemStatus,
} from '~/lib/contracts'
import { sku } from '~/modules/catalog/public'
import type { TenantTx } from '~/server/db'
import { createLogger } from '~/server/log'
import { bill, billItem, billItemModifier } from './schema'

const log = createLogger('fnb.bills_snapshot')
export const MAX_BILLS_SNAPSHOT_ROWS = 200

export function billsEtag(parts: {
  outletId: string
  maxLastEventAt: string | null
  count: number
  sumLastEventSeq: number
}): string {
  return createHash('sha256')
    .update(`${parts.outletId}|${parts.maxLastEventAt ?? ''}|${parts.count}|${parts.sumLastEventSeq}`)
    .digest('hex')
    .slice(0, 16)
}

async function loadItemsWithModifiers(
  tx: TenantTx,
  tenantId: string,
  billIds: readonly string[],
  statuses: readonly BillItemStatus[],
): Promise<Map<string, BillSnapshotItem[]>> {
  const byBill = new Map<string, BillSnapshotItem[]>()
  if (billIds.length === 0) return byBill

  const items = await tx
    .select({
      id: billItem.id,
      billId: billItem.billId,
      lineNo: billItem.lineNo,
      productId: sku.productId,
      skuId: billItem.skuId,
      uomId: billItem.uomId,
      skuCode: billItem.skuCode,
      itemName: billItem.itemName,
      uomCode: billItem.uomCode,
      qty: billItem.qty,
      conversionFactor: billItem.conversionFactor,
      unitPrice: billItem.unitPrice,
      priceSource: billItem.priceSource,
      isOpenPrice: billItem.isOpenPrice,
      taxable: billItem.taxable,
      discountType: billItem.discountType,
      discountPct: billItem.discountPct,
      discountInput: billItem.discountInput,
      discountApprovedBy: billItem.discountApprovedBy,
      note: billItem.note,
      status: billItem.status,
      voidReasonText: billItem.voidReasonText,
      createdEventId: billItem.createdEventId,
    })
    .from(billItem)
    .leftJoin(sku, and(eq(sku.tenantId, billItem.tenantId), eq(sku.id, billItem.skuId)))
    .where(
      and(
        eq(billItem.tenantId, tenantId),
        inArray(billItem.billId, [...billIds]),
        inArray(billItem.status, [...statuses]),
      ),
    )
    .orderBy(asc(billItem.billId), asc(billItem.lineNo))

  if (items.length === 0) return byBill

  const itemIds = items.map((i) => i.id)
  const mods = await tx
    .select()
    .from(billItemModifier)
    .where(and(eq(billItemModifier.tenantId, tenantId), inArray(billItemModifier.billItemId, itemIds)))

  const modsByItem = new Map<string, BillSnapshotModifier[]>()
  for (const m of mods) {
    const arr = modsByItem.get(m.billItemId) ?? []
    arr.push({
      modifier_id: m.modifierId,
      name: m.name,
      price_delta: m.priceDelta,
      qty: m.qty,
    })
    modsByItem.set(m.billItemId, arr)
  }

  for (const it of items) {
    const arr = byBill.get(it.billId) ?? []
    arr.push({
      id: it.id,
      line_no: it.lineNo,
      product_id: it.productId ?? null,
      sku_id: it.skuId,
      uom_id: it.uomId,
      sku_code: it.skuCode,
      item_name: it.itemName,
      uom_code: it.uomCode,
      qty: it.qty,
      conversion_factor: it.conversionFactor,
      unit_price: it.unitPrice,
      price_source: it.priceSource as PriceSource,
      is_open_price: it.isOpenPrice,
      taxable: it.taxable,
      discount_type: (it.discountType as DiscountType | null) ?? null,
      discount_pct: it.discountPct ?? null,
      discount_input: it.discountInput ?? null,
      discount_approved_by: it.discountApprovedBy ?? null,
      note: it.note ?? null,
      status: it.status as BillItemStatus,
      void_reason_text: it.voidReasonText ?? null,
      created_event_id: it.createdEventId,
      modifiers: modsByItem.get(it.id) ?? [],
    })
    byBill.set(it.billId, arr)
  }

  return byBill
}

/**
 * Builds the `bills` snapshot block for one device within the same read-only transaction (ARCH §4.3.3).
 * Excludes bills currently leased by the requesting device (`lease_device_id <> deviceId`) and strips `customer_phone`.
 */
export async function getBillsSnapshot(
  tx: TenantTx,
  input: {
    tenantId: string
    outletId: string
    deviceId: string
    registerId: string
    nowIso: string
  },
): Promise<{ etag: string; block: BillsSnapshotBlock }> {
  const fetched = await tx
    .select({
      id: bill.id,
      tableId: bill.tableId,
      billRef: bill.billRef,
      status: bill.status,
      leaseDeviceId: bill.leaseDeviceId,
      leaseRegisterId: bill.leaseRegisterId,
      handoverStatus: bill.handoverStatus,
      handoverTargetRegisterId: bill.handoverTargetRegisterId,
      prebillSeq: bill.prebillSeq,
      lastContentSeq: bill.lastContentSeq,
      lastEventSeq: bill.lastEventSeq,
      lastEventAt: bill.lastEventAt,
      billDiscountType: bill.billDiscountType,
      billDiscountPct: bill.billDiscountPct,
      billDiscountInput: bill.billDiscountInput,
      billDiscountApprovedBy: bill.billDiscountApprovedBy,
      customerName: bill.customerName,
      splitMode: bill.splitMode,
      parentBillId: bill.parentBillId,
      shareIndex: bill.shareIndex,
      shareCount: bill.shareCount,
    })
    .from(bill)
    .where(
      and(
        eq(bill.tenantId, input.tenantId),
        eq(bill.outletId, input.outletId),
        eq(bill.status, 'OPEN'),
        ne(bill.leaseDeviceId, input.deviceId),
      ),
    )
    .orderBy(sql`${bill.lastEventAt} DESC NULLS LAST`, desc(bill.id))
    .limit(MAX_BILLS_SNAPSHOT_ROWS + 1)

  const truncated = fetched.length > MAX_BILLS_SNAPSHOT_ROWS
  const billRows = truncated ? fetched.slice(0, MAX_BILLS_SNAPSHOT_ROWS) : fetched

  if (truncated) {
    log.warn(
      {
        tenantId: input.tenantId,
        outletId: input.outletId,
        deviceId: input.deviceId,
        reason: 'bills_snapshot_truncated',
      },
      `open bills snapshot truncated to ${MAX_BILLS_SNAPSHOT_ROWS} most recent rows`,
    )
  }

  let maxLastEventAt: string | null = null
  let sumLastEventSeq = 0
  for (const r of billRows) {
    sumLastEventSeq += r.lastEventSeq
    if (r.lastEventAt && (!maxLastEventAt || r.lastEventAt > maxLastEventAt)) {
      maxLastEventAt = r.lastEventAt
    }
  }

  const etag = billsEtag({
    outletId: input.outletId,
    maxLastEventAt,
    count: billRows.length,
    sumLastEventSeq,
  })

  const itemsByBill = await loadItemsWithModifiers(
    tx,
    input.tenantId,
    billRows.map((b) => b.id),
    ['ACTIVE', 'VOIDED'],
  )

  const rows: BillSnapshotRow[] = billRows.map((r) => {
    const isAwaitingPayment = r.prebillSeq !== null && r.prebillSeq > r.lastContentSeq
    return {
      bill_id: r.id,
      table_id: r.tableId,
      bill_ref: r.billRef,
      status: r.status as BillStatus,
      lease_device_id: r.leaseDeviceId,
      lease_register_id: r.leaseRegisterId,
      is_awaiting_payment: isAwaitingPayment,
      handover_status: r.handoverStatus as BillHandoverStatus,
      handover_target_register_id:
        r.handoverStatus === 'PENDING' ? (r.handoverTargetRegisterId ?? null) : null,
      last_event_seq: r.lastEventSeq,
      last_event_at: r.lastEventAt ?? null,
      bill_discount_type: (r.billDiscountType as DiscountType | null) ?? null,
      bill_discount_pct: r.billDiscountPct ?? null,
      bill_discount_input: r.billDiscountInput ?? null,
      bill_discount_approved_by: r.billDiscountApprovedBy ?? null,
      customer_name: r.customerName ?? null,
      split_mode: (r.splitMode as BillSplitMode | null) ?? null,
      parent_bill_id: r.parentBillId ?? null,
      share_index: r.shareIndex ?? null,
      share_count: r.shareCount ?? null,
      items: itemsByBill.get(r.id) ?? [],
    }
  })

  return {
    etag,
    block: {
      etag,
      as_of_server_time: input.nowIso,
      rows,
      ...(truncated ? { truncated: true } : {}),
    },
  }
}

/**
 * Loads full bill details (including `customer_phone`, modifiers, and discounts) strictly scoped
 * to `tenantId + outletId` for post-accept local materialization (`GET /api/pos/v1/bills/{id}`).
 */
export async function getBillDetail(
  tx: TenantTx,
  input: { tenantId: string; outletId: string; billId: string },
): Promise<BillDetailResponse | null> {
  const rows = await tx
    .select()
    .from(bill)
    .where(and(eq(bill.tenantId, input.tenantId), eq(bill.outletId, input.outletId), eq(bill.id, input.billId)))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const itemsByBill = await loadItemsWithModifiers(tx, input.tenantId, [row.id], ['ACTIVE', 'VOIDED'])
  const isAwaitingPayment = row.prebillSeq !== null && row.prebillSeq > row.lastContentSeq

  return {
    id: row.id,
    tenant_id: row.tenantId,
    outlet_id: row.outletId,
    register_id: row.registerId,
    device_id: row.deviceId,
    table_id: row.tableId,
    bill_ref: row.billRef,
    status: row.status as BillStatus,
    lease_device_id: row.leaseDeviceId,
    lease_register_id: row.leaseRegisterId,
    handover_status: row.handoverStatus as BillHandoverStatus,
    handover_target_register_id: row.handoverTargetRegisterId ?? null,
    handover_event_id: row.handoverEventId ?? null,
    handover_requested_at: row.handoverRequestedAt ?? null,
    prebill_seq: row.prebillSeq ?? null,
    prebill_printed_at: row.prebillPrintedAt ?? null,
    last_content_seq: row.lastContentSeq,
    is_awaiting_payment: isAwaitingPayment,
    bill_discount_type: (row.billDiscountType as DiscountType | null) ?? null,
    bill_discount_pct: row.billDiscountPct ?? null,
    bill_discount_input: row.billDiscountInput ?? null,
    bill_discount_approved_by: row.billDiscountApprovedBy ?? null,
    customer_name: row.customerName ?? null,
    customer_phone: row.customerPhone ?? null,
    split_mode: (row.splitMode as BillSplitMode | null) ?? null,
    parent_bill_id: row.parentBillId ?? null,
    share_index: row.shareIndex ?? null,
    share_count: row.shareCount ?? null,
    last_event_seq: row.lastEventSeq,
    last_event_at: row.lastEventAt ?? null,
    created_by: row.createdBy,
    created_at_device: row.createdAtDevice,
    occurred_at: row.occurredAt,
    business_date: row.businessDate,
    items: itemsByBill.get(row.id) ?? [],
  }
}
