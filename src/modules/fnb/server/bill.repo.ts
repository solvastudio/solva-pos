import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type {
  BillHandoverStatus,
  BillItemStatus,
  BillSplitMode,
  BillStatus,
  DiscountType,
  PriceSource,
} from '~/lib/contracts'
import { runtimeIdGenerator as billRepoIdGen } from '~/lib/runtime-id'
import type { TenantTx } from '~/server/db'
import type {
  BillEventEnvelopeV1,
  BillProjectionItem,
  BillProjectionItemModifier,
  BillProjectionState,
} from '../shared'
import { bill, billEvent, billItem, billItemModifier, fnbTable } from './schema'

export interface BillRow {
  readonly id: string
  readonly tenantId: string
  readonly outletId: string
  readonly tableId: string
  readonly billRef: string
  readonly status: BillStatus
  readonly leaseDeviceId: string
  readonly leaseRegisterId: string
  readonly handoverStatus: BillHandoverStatus
  readonly handoverTargetRegisterId: string | null
  readonly handoverEventId: string | null
  readonly handoverRequestedAt: string | null
  readonly prebillSeq: number | null
  readonly prebillPrintedAt: string | null
  readonly lastContentSeq: number
  readonly parentBillId: string | null
  readonly splitMode: BillSplitMode | null
  readonly shareIndex: number | null
  readonly shareCount: number | null
  readonly mergedIntoBillId: string | null
  readonly billDiscountType: DiscountType | null
  readonly billDiscountPct: string | null
  readonly billDiscountInput: number | null
  readonly billDiscountApprovedBy: string | null
  readonly customerName: string | null
  readonly customerPhone: string | null
  readonly lastEventSeq: number
  readonly lastEventAt: string | null
  readonly closedAt: string | null
}

function mapBillRow(r: typeof bill.$inferSelect): BillRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    outletId: r.outletId,
    tableId: r.tableId,
    billRef: r.billRef,
    status: r.status as BillStatus,
    leaseDeviceId: r.leaseDeviceId,
    leaseRegisterId: r.leaseRegisterId,
    handoverStatus: r.handoverStatus as BillHandoverStatus,
    handoverTargetRegisterId: r.handoverTargetRegisterId,
    handoverEventId: r.handoverEventId,
    handoverRequestedAt: r.handoverRequestedAt,
    prebillSeq: r.prebillSeq,
    prebillPrintedAt: r.prebillPrintedAt,
    lastContentSeq: r.lastContentSeq,
    parentBillId: r.parentBillId,
    splitMode: (r.splitMode as BillSplitMode | null) ?? null,
    shareIndex: r.shareIndex,
    shareCount: r.shareCount,
    mergedIntoBillId: r.mergedIntoBillId,
    billDiscountType: (r.billDiscountType as DiscountType | null) ?? null,
    billDiscountPct: r.billDiscountPct,
    billDiscountInput: r.billDiscountInput,
    billDiscountApprovedBy: r.billDiscountApprovedBy,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    lastEventSeq: r.lastEventSeq,
    lastEventAt: r.lastEventAt,
    closedAt: r.closedAt,
  }
}

export function newBillRepoId(): string {
  return billRepoIdGen.newId()
}

export async function lockBillForUpdate(
  tx: TenantTx,
  tenantId: string,
  billId: string,
): Promise<BillRow | null> {
  const rows = await tx
    .select()
    .from(bill)
    .where(and(eq(bill.tenantId, tenantId), eq(bill.id, billId)))
    .for('update')
    .limit(1)
  return rows[0] ? mapBillRow(rows[0]) : null
}

/**
 * Locks multiple bills in deterministic ascending UUID order to avoid cross-transaction deadlocks.
 */
export async function lockBillsForUpdate(
  tx: TenantTx,
  tenantId: string,
  billIds: readonly string[],
): Promise<Map<string, BillRow>> {
  const sorted = [...new Set(billIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const out = new Map<string, BillRow>()
  if (sorted.length === 0) return out
  const rows = await tx
    .select()
    .from(bill)
    .where(and(eq(bill.tenantId, tenantId), inArray(bill.id, sorted)))
    .orderBy(asc(bill.id))
    .for('update')
  for (const r of rows) {
    out.set(r.id, mapBillRow(r))
  }
  return out
}

export async function readBillLastEventSeq(
  tx: TenantTx,
  tenantId: string,
  billId: string,
): Promise<number | null> {
  const rows = await tx
    .select({ lastEventSeq: bill.lastEventSeq })
    .from(bill)
    .where(and(eq(bill.tenantId, tenantId), eq(bill.id, billId)))
    .limit(1)
  return rows[0]?.lastEventSeq ?? null
}

export async function loadBillProjectionState(
  tx: TenantTx,
  tenantId: string,
  row: BillRow,
): Promise<BillProjectionState> {
  const itemRows = await tx
    .select()
    .from(billItem)
    .where(and(eq(billItem.tenantId, tenantId), eq(billItem.billId, row.id)))

  const itemIds = itemRows.map((it) => it.id)
  const modByItem = new Map<string, BillProjectionItemModifier[]>()
  if (itemIds.length > 0) {
    const modRows = await tx
      .select()
      .from(billItemModifier)
      .where(and(eq(billItemModifier.tenantId, tenantId), inArray(billItemModifier.billItemId, itemIds)))
    for (const m of modRows) {
      let list = modByItem.get(m.billItemId)
      if (!list) {
        list = []
        modByItem.set(m.billItemId, list)
      }
      list.push({
        modifierId: m.modifierId,
        name: m.name,
        priceDelta: m.priceDelta,
        qty: m.qty,
      })
    }
  }

  const items = new Map<string, BillProjectionItem>()
  for (const it of itemRows) {
    items.set(it.id, {
      id: it.id,
      lineNo: it.lineNo,
      skuId: it.skuId,
      uomId: it.uomId,
      skuCode: it.skuCode,
      itemName: it.itemName,
      uomCode: it.uomCode,
      qty: it.qty,
      conversionFactor: it.conversionFactor,
      unitPrice: it.unitPrice,
      priceSource: it.priceSource as PriceSource,
      isOpenPrice: it.isOpenPrice,
      taxable: it.taxable,
      discountType: (it.discountType as DiscountType | null) ?? null,
      discountPct: it.discountPct,
      discountInput: it.discountInput,
      discountApprovedBy: it.discountApprovedBy,
      note: it.note,
      status: it.status as BillItemStatus,
      voidReasonCode: it.voidReasonCode,
      voidReasonText: it.voidReasonText,
      createdEventId: it.createdEventId,
      modifiers: modByItem.get(it.id) ?? [],
    })
  }

  return {
    billId: row.id,
    status: row.status,
    tableId: row.tableId,
    billRef: row.billRef,
    leaseDeviceId: row.leaseDeviceId,
    leaseRegisterId: row.leaseRegisterId,
    handoverStatus: row.handoverStatus,
    handoverTargetRegisterId: row.handoverTargetRegisterId,
    handoverEventId: row.handoverEventId,
    handoverRequestedAt: row.handoverRequestedAt,
    prebillSeq: row.prebillSeq,
    prebillPrintedAt: row.prebillPrintedAt,
    lastContentSeq: row.lastContentSeq,
    splitMode: row.splitMode,
    billDiscountType: row.billDiscountType,
    billDiscountPct: row.billDiscountPct,
    billDiscountInput: row.billDiscountInput,
    billDiscountApprovedBy: row.billDiscountApprovedBy,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    lastEventSeq: row.lastEventSeq,
    lastEventAt: row.lastEventAt,
    closedAt: row.closedAt,
    items,
    appliedEventIds: new Set(),
  }
}

export async function loadExistingBillEventIds(
  tx: TenantTx,
  tenantId: string,
  eventIds: readonly string[],
): Promise<Map<string, { billId: string; billSeq: number }>> {
  const out = new Map<string, { billId: string; billSeq: number }>()
  if (eventIds.length === 0) return out
  const rows = await tx
    .select({ id: billEvent.id, billId: billEvent.billId, billSeq: billEvent.billSeq })
    .from(billEvent)
    .where(and(eq(billEvent.tenantId, tenantId), inArray(billEvent.id, [...new Set(eventIds)])))
  for (const r of rows) {
    out.set(r.id, { billId: r.billId, billSeq: r.billSeq })
  }
  return out
}

export async function findBillEventSeqConflicts(
  tx: TenantTx,
  tenantId: string,
  billId: string,
  seqs: readonly number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (seqs.length === 0) return out
  const rows = await tx
    .select({ id: billEvent.id, billSeq: billEvent.billSeq })
    .from(billEvent)
    .where(
      and(
        eq(billEvent.tenantId, tenantId),
        eq(billEvent.billId, billId),
        inArray(billEvent.billSeq, [...new Set(seqs)]),
      ),
    )
  for (const r of rows) {
    out.set(r.billSeq, r.id)
  }
  return out
}

export async function findMissingTablesInOutlet(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
  tableIds: readonly string[],
): Promise<string | null> {
  const uniqueIds = [...new Set(tableIds)]
  if (uniqueIds.length === 0) return null
  const found = await tx
    .select({ id: fnbTable.id })
    .from(fnbTable)
    .where(
      and(
        eq(fnbTable.tenantId, tenantId),
        eq(fnbTable.outletId, outletId),
        inArray(fnbTable.id, uniqueIds),
        isNull(fnbTable.deletedAt),
      ),
    )
  const set = new Set(found.map((t) => t.id))
  for (const id of uniqueIds) {
    if (!set.has(id)) return id
  }
  return null
}

export async function insertInitialBillRow(
  tx: TenantTx,
  params: {
    billId: string
    tenantId: string
    outletId: string
    registerId: string
    deviceId: string
    tableId: string
    billRef: string
    createdBy: string
    createdAtDevice: string
    clockOffsetMs: number
    occurredAt: string
    businessDate: string
    receivedAtIso: string
    commandId: string
    schemaVersion: number
    appVersion: string | null
  },
): Promise<void> {
  await tx.insert(bill).values({
    id: params.billId,
    tenantId: params.tenantId,
    outletId: params.outletId,
    registerId: params.registerId,
    deviceId: params.deviceId,
    createdBy: params.createdBy,
    createdAtDevice: params.createdAtDevice,
    clockOffsetMs: params.clockOffsetMs,
    occurredAt: params.occurredAt,
    businessDate: params.businessDate,
    receivedAt: params.receivedAtIso,
    commandId: params.commandId,
    schemaVersion: params.schemaVersion,
    appVersion: params.appVersion,
    tableId: params.tableId,
    billRef: params.billRef,
    status: 'OPEN',
    leaseDeviceId: params.deviceId,
    leaseRegisterId: params.registerId,
    handoverStatus: 'NONE',
    lastContentSeq: 0,
    lastEventSeq: 0,
    lastEventAt: params.receivedAtIso,
  })
}

export interface BillEventInsertRow {
  readonly id: string
  readonly tenantId: string
  readonly outletId: string
  readonly billId: string
  readonly billSeq: number
  readonly deviceId: string
  readonly registerId: string
  readonly deviceSeq: number
  readonly staffId: string
  readonly eventType: string
  readonly payload: Record<string, unknown>
  readonly reasonCode: string | null
  readonly reasonText: string | null
  readonly originBillId: string | null
  readonly originEventIds: string[] | null
  readonly targetRegisterId: string | null
  readonly handoverEventId: string | null
  readonly createdAtDevice: string
  readonly clockOffsetMs: number
  readonly occurredAt: string
  readonly businessDate: string
  readonly receivedAt: string
  readonly commandId: string
  readonly schemaVersion: number
  readonly appVersion: string | null
}

export async function insertBillEvents(
  tx: TenantTx,
  rows: readonly BillEventInsertRow[],
): Promise<void> {
  if (rows.length === 0) return
  await tx
    .insert(billEvent)
    .values(
      rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        outletId: r.outletId,
        billId: r.billId,
        billSeq: r.billSeq,
        deviceId: r.deviceId,
        registerId: r.registerId,
        deviceSeq: r.deviceSeq,
        staffId: r.staffId,
        eventType: r.eventType,
        payload: r.payload,
        reasonCode: r.reasonCode,
        reasonText: r.reasonText,
        originBillId: r.originBillId,
        originEventIds: r.originEventIds,
        targetRegisterId: r.targetRegisterId,
        handoverEventId: r.handoverEventId,
        createdAtDevice: r.createdAtDevice,
        clockOffsetMs: r.clockOffsetMs,
        occurredAt: r.occurredAt,
        businessDate: r.businessDate,
        receivedAt: r.receivedAt,
        commandId: r.commandId,
        schemaVersion: r.schemaVersion,
        appVersion: r.appVersion,
      })),
    )
    .onConflictDoNothing({ target: billEvent.id })
}

export async function persistBillProjectionDiff(
  tx: TenantTx,
  params: {
    tenantId: string
    outletId: string
    prevState: BillProjectionState
    nextState: BillProjectionState
    receivedAtIso: string
    hasPrebillPrinted: boolean
  },
): Promise<void> {
  const { tenantId, outletId, prevState, nextState, receivedAtIso, hasPrebillPrinted } = params

  await tx
    .update(bill)
    .set({
      tableId: nextState.tableId!,
      billRef: nextState.billRef!,
      status: nextState.status,
      handoverStatus: nextState.handoverStatus,
      handoverTargetRegisterId: nextState.handoverTargetRegisterId,
      handoverEventId: nextState.handoverEventId,
      handoverRequestedAt: nextState.handoverRequestedAt,
      prebillSeq: nextState.prebillSeq,
      prebillPrintedAt: hasPrebillPrinted ? receivedAtIso : nextState.prebillPrintedAt,
      lastContentSeq: nextState.lastContentSeq,
      billDiscountType: nextState.billDiscountType,
      billDiscountPct: nextState.billDiscountPct,
      billDiscountInput: nextState.billDiscountInput,
      billDiscountApprovedBy: nextState.billDiscountApprovedBy,
      customerName: nextState.customerName,
      customerPhone: nextState.customerPhone,
      lastEventSeq: nextState.lastEventSeq,
      lastEventAt: receivedAtIso,
      closedAt: nextState.status === 'CANCELED' ? receivedAtIso : nextState.closedAt,
    })
    .where(and(eq(bill.tenantId, tenantId), eq(bill.id, nextState.billId)))

  for (const [itemId, nextItem] of nextState.items.entries()) {
    const prevItem = prevState.items.get(itemId)
    if (!prevItem) {
      await tx.insert(billItem).values({
        id: nextItem.id,
        tenantId,
        outletId,
        billId: nextState.billId,
        lineNo: nextItem.lineNo,
        skuId: nextItem.skuId,
        uomId: nextItem.uomId,
        skuCode: nextItem.skuCode,
        itemName: nextItem.itemName,
        uomCode: nextItem.uomCode,
        qty: nextItem.qty,
        conversionFactor: nextItem.conversionFactor,
        unitPrice: nextItem.unitPrice,
        priceSource: nextItem.priceSource,
        isOpenPrice: nextItem.isOpenPrice,
        taxable: nextItem.taxable,
        discountType: nextItem.discountType,
        discountPct: nextItem.discountPct,
        discountInput: nextItem.discountInput,
        discountApprovedBy: nextItem.discountApprovedBy,
        note: nextItem.note,
        status: nextItem.status,
        voidReasonCode: nextItem.voidReasonCode,
        voidReasonText: nextItem.voidReasonText,
        createdEventId: nextItem.createdEventId,
      })
      if (nextItem.modifiers.length > 0) {
        await tx.insert(billItemModifier).values(
          nextItem.modifiers.map((m) => ({
            id: billRepoIdGen.newId(),
            tenantId,
            billItemId: nextItem.id,
            modifierId: m.modifierId,
            name: m.name,
            priceDelta: m.priceDelta,
            qty: m.qty,
          })),
        )
      }
      continue
    }

    if (prevItem !== nextItem) {
      await tx
        .update(billItem)
        .set({
          qty: nextItem.qty,
          unitPrice: nextItem.unitPrice,
          discountType: nextItem.discountType,
          discountPct: nextItem.discountPct,
          discountInput: nextItem.discountInput,
          discountApprovedBy: nextItem.discountApprovedBy,
          status: nextItem.status,
          voidReasonCode: nextItem.voidReasonCode,
          voidReasonText: nextItem.voidReasonText,
        })
        .where(and(eq(billItem.tenantId, tenantId), eq(billItem.id, nextItem.id)))

      if (prevItem.modifiers !== nextItem.modifiers) {
        await tx
          .delete(billItemModifier)
          .where(and(eq(billItemModifier.tenantId, tenantId), eq(billItemModifier.billItemId, nextItem.id)))
        if (nextItem.modifiers.length > 0) {
          await tx.insert(billItemModifier).values(
            nextItem.modifiers.map((m) => ({
              id: billRepoIdGen.newId(),
              tenantId,
              billItemId: nextItem.id,
              modifierId: m.modifierId,
              name: m.name,
              priceDelta: m.priceDelta,
              qty: m.qty,
            })),
          )
        }
      }
    }
  }
}

export async function countOpenBillsOnTable(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
  tableId: string,
): Promise<number> {
  // Siblings sharing the same parent_bill_id are split bills, not accidental duplicate bills.
  const res = await tx.execute<{ cnt: number }>(sql`
    SELECT count(DISTINCT COALESCE(parent_bill_id, id))::int AS cnt
    FROM bill
    WHERE tenant_id = ${tenantId}::uuid
      AND outlet_id = ${outletId}::uuid
      AND table_id = ${tableId}::uuid
      AND status = 'OPEN'
  `)
  return Number(res.rows[0]?.cnt ?? 0)
}

export async function updateBillHandoverPending(
  tx: TenantTx,
  params: {
    tenantId: string
    billId: string
    targetRegisterId: string
    handoverEventId: string
    nextSeq: number
    nowIso: string
  },
): Promise<void> {
  await tx
    .update(bill)
    .set({
      handoverStatus: 'PENDING',
      handoverTargetRegisterId: params.targetRegisterId,
      handoverEventId: params.handoverEventId,
      handoverRequestedAt: params.nowIso,
      lastEventSeq: params.nextSeq,
      lastEventAt: params.nowIso,
    })
    .where(and(eq(bill.tenantId, params.tenantId), eq(bill.id, params.billId)))
}

export async function updateBillHandoverAccepted(
  tx: TenantTx,
  params: {
    tenantId: string
    billId: string
    leaseDeviceId: string
    leaseRegisterId: string
    nextSeq: number
    nowIso: string
  },
): Promise<void> {
  await tx.execute(sql`SET LOCAL app.bill_lease_change = 'on'`)
  await tx
    .update(bill)
    .set({
      leaseDeviceId: params.leaseDeviceId,
      leaseRegisterId: params.leaseRegisterId,
      handoverStatus: 'NONE',
      handoverTargetRegisterId: null,
      handoverEventId: null,
      handoverRequestedAt: null,
      lastEventSeq: params.nextSeq,
      lastEventAt: params.nowIso,
    })
    .where(and(eq(bill.tenantId, params.tenantId), eq(bill.id, params.billId)))
}

export async function updateBillHandoverCanceled(
  tx: TenantTx,
  params: {
    tenantId: string
    billId: string
    nextSeq: number
    nowIso: string
  },
): Promise<void> {
  await tx
    .update(bill)
    .set({
      handoverStatus: 'NONE',
      handoverTargetRegisterId: null,
      handoverEventId: null,
      handoverRequestedAt: null,
      lastEventSeq: params.nextSeq,
      lastEventAt: params.nowIso,
    })
    .where(and(eq(bill.tenantId, params.tenantId), eq(bill.id, params.billId)))
}

export async function getBillForPayment(
  tx: TenantTx,
  tenantId: string,
  billId: string,
): Promise<{
  readonly id: string
  readonly outletId: string
  readonly billRef: string
  readonly status: string
  readonly leaseDeviceId: string
  readonly leaseRegisterId: string
  readonly handoverStatus: string
  readonly splitMode: string | null
  readonly parentBillId: string | null
  readonly shareIndex: number | null
  readonly shareCount: number | null
  readonly siblingBillIds: readonly string[]
} | null> {
  const row = await lockBillForUpdate(tx, tenantId, billId)
  if (!row) return null
  let siblingBillIds: string[] = []
  if (row.parentBillId !== null) {
    const siblings = await tx
      .select({ id: bill.id })
      .from(bill)
      .where(and(eq(bill.tenantId, tenantId), eq(bill.parentBillId, row.parentBillId)))
    siblingBillIds = siblings.map((s) => s.id)
  }
  return {
    id: row.id,
    outletId: row.outletId,
    billRef: row.billRef,
    status: row.status,
    leaseDeviceId: row.leaseDeviceId,
    leaseRegisterId: row.leaseRegisterId,
    handoverStatus: row.handoverStatus,
    splitMode: row.splitMode,
    parentBillId: row.parentBillId,
    shareIndex: row.shareIndex,
    shareCount: row.shareCount,
    siblingBillIds,
  }
}

export async function markBillPaid(
  tx: TenantTx,
  tenantId: string,
  billId: string,
  nowIso: string,
): Promise<void> {
  const updated = await tx
    .update(bill)
    .set({
      status: 'PAID',
      closedAt: nowIso,
      lastEventAt: nowIso,
    })
    .where(and(eq(bill.tenantId, tenantId), eq(bill.id, billId)))
    .returning({ parentBillId: bill.parentBillId })

  const parentBillId = updated[0]?.parentBillId ?? null
  if (parentBillId !== null) {
    await closeSplitParentIfAllChildrenSettled(tx, tenantId, parentBillId, nowIso)
  }
}

export async function closeSplitParentIfAllChildrenSettled(
  tx: TenantTx,
  tenantId: string,
  parentBillId: string,
  nowIso: string,
): Promise<boolean> {
  const parentRow = await lockBillForUpdate(tx, tenantId, parentBillId)
  if (!parentRow || parentRow.status !== 'SPLIT') {
    return false
  }
  const openCountRes = await tx.execute<{ cnt: number }>(sql`
    SELECT count(*)::int AS cnt
    FROM bill
    WHERE tenant_id = ${tenantId}::uuid
      AND parent_bill_id = ${parentBillId}::uuid
      AND status = 'OPEN'
  `)
  const remainingOpen = Number(openCountRes.rows[0]?.cnt ?? 0)
  if (remainingOpen > 0) {
    return false
  }
  await tx
    .update(bill)
    .set({
      status: 'CLOSED_BY_SPLIT',
      closedAt: nowIso,
      lastEventAt: nowIso,
    })
    .where(and(eq(bill.tenantId, tenantId), eq(bill.id, parentBillId)))
  return true
}

export function envelopeToInsertRow(
  evt: BillEventEnvelopeV1,
  ctx: { tenantId: string; outletId: string; commandId: string; receivedAtIso: string; appVersion: string | null },
): BillEventInsertRow {
  return {
    id: evt.id,
    tenantId: ctx.tenantId,
    outletId: ctx.outletId,
    billId: evt.bill_id,
    billSeq: evt.bill_seq,
    deviceId: evt.device_id,
    registerId: evt.register_id,
    deviceSeq: evt.device_seq,
    staffId: evt.staff_id,
    eventType: evt.event_type,
    payload: evt.payload,
    reasonCode: evt.reason_code ?? null,
    reasonText: evt.reason_text ?? null,
    originBillId: evt.origin_bill_id ?? null,
    originEventIds: evt.origin_event_ids ?? null,
    targetRegisterId: evt.target_register_id ?? null,
    handoverEventId: evt.handover_event_id ?? null,
    createdAtDevice: evt.created_at_device,
    clockOffsetMs: evt.clock_offset_ms,
    occurredAt: evt.occurred_at,
    businessDate: evt.business_date,
    receivedAt: ctx.receivedAtIso,
    commandId: ctx.commandId,
    schemaVersion: evt.schema_version,
    appVersion: evt.app_version ?? ctx.appVersion,
  }
}
