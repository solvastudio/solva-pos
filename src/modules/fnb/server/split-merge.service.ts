import '@tanstack/react-start/server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { addQty, allocateLR, cmpQty, parseQty, toMoney, ZERO } from '~/lib/kernel'
import { calcLineDiscount, calcLineGross } from '~/lib/sales-calc'
import { CommandRejected, type CommandContext } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import {
  BillMergedPayloadSchema,
  BillSplitPayloadSchema,
  mergeSimilarItems,
  type BillEventEnvelopeV1,
  type BillProjectionItem,
  type BillProjectionState,
} from '../shared'
import {
  findMissingTablesInOutlet,
  insertBillEvents,
  newBillRepoId,
  type BillRow,
} from './bill.repo'
import { bill, billItem, billItemModifier } from './schema'

async function allocateDeviceSeqBase(tx: TenantTx, tenantId: string, deviceId: string): Promise<number> {
  const res = await tx.execute<{ max_seq: string | number }>(sql`
    SELECT COALESCE(MAX(device_seq), 0)::bigint AS max_seq
    FROM bill_event
    WHERE tenant_id = ${tenantId}::uuid
      AND device_id = ${deviceId}::uuid
  `)
  return Number(res.rows[0]?.max_seq ?? 0)
}

function sumActiveItemNet(item: BillProjectionItem): number {
  const gross = calcLineGross(toMoney(item.unitPrice), parseQty(item.qty))
  const disc =
    item.discountType === 'PERCENT' && item.discountPct !== null
      ? calcLineDiscount(gross, { kind: 'PERCENT', percent: item.discountPct })
      : item.discountType === 'NOMINAL' && item.discountInput !== null
        ? calcLineDiscount(gross, { kind: 'NOMINAL', amount: toMoney(item.discountInput) })
        : ZERO
  return gross - disc
}

/**
 * Executes `BILL_SPLIT` inside the active tenant transaction after parent and child IDs
 * have been validated and locked in deterministic order.
 */
export async function executeBillSplit(
  tx: TenantTx,
  ctx: CommandContext,
  params: {
    parentState: BillProjectionState
    parentRow: BillRow | null
    evt: BillEventEnvelopeV1
    lockedBills: ReadonlyMap<string, BillRow>
  },
): Promise<void> {
  const { parentState, parentRow, evt, lockedBills } = params
  const tenantId = ctx.device.tenantId
  const outletId = ctx.device.outletId
  const payload = BillSplitPayloadSchema.parse(evt.payload)

  if (parentState.status !== 'OPEN') {
    throw new CommandRejected('STRUCTURAL', 'BILL_CLOSED', `Bill ${parentState.billId} is ${parentState.status}`)
  }
  if (parentState.handoverStatus === 'PENDING') {
    throw new CommandRejected(
      'AUTHORIZATION',
      'BILL_READ_ONLY',
      'Cannot split a bill pending handover acceptance',
    )
  }
  if (parentRow?.splitMode === 'EQUAL') {
    throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', 'Cannot split an equal-share bill again')
  }

  const activeItems = new Map<string, BillProjectionItem>()
  for (const item of parentState.items.values()) {
    if (item.status === 'ACTIVE') {
      activeItems.set(item.id, item)
    }
  }
  if (activeItems.size === 0) {
    throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', 'Cannot split a bill with no active items')
  }

  for (const child of payload.children) {
    if (lockedBills.has(child.child_bill_id) || child.child_bill_id === parentState.billId) {
      throw new CommandRejected(
        'STRUCTURAL',
        'VALIDATION_FAILED',
        `Split child_bill_id ${child.child_bill_id} already exists`,
      )
    }
  }

  const extraTableIds = payload.children
    .map((c) => c.table_id)
    .filter((id): id is string => Boolean(id) && id !== parentState.tableId)
  if (extraTableIds.length > 0) {
    const missingTable = await findMissingTablesInOutlet(tx, tenantId, outletId, extraTableIds)
    if (missingTable) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown child table_id ${missingTable}`)
    }
  }

  // Validate full item/qty partition coverage when ITEM or QTY mode.
  const movedSums = new Map<string, ReturnType<typeof parseQty>>()
  const specsBySourceItem = new Map<string, { childIdx: number; qty: string; itemId: string }[]>()
  if (payload.split_mode !== 'EQUAL') {
    for (let ci = 0; ci < payload.children.length; ci += 1) {
      const child = payload.children[ci]!
      for (const spec of child.items) {
        const src = activeItems.get(spec.source_bill_item_id)
        if (!src) {
          throw new CommandRejected(
            'STRUCTURAL',
            'VALIDATION_FAILED',
            `Unknown or non-ACTIVE source_bill_item_id ${spec.source_bill_item_id}`,
          )
        }
        const prevSum = movedSums.get(spec.source_bill_item_id)
        const specQty = parseQty(spec.qty)
        movedSums.set(spec.source_bill_item_id, prevSum ? parseQty(addQty(prevSum, specQty)) : specQty)
        let list = specsBySourceItem.get(spec.source_bill_item_id)
        if (!list) {
          list = []
          specsBySourceItem.set(spec.source_bill_item_id, list)
        }
        list.push({ childIdx: ci, qty: spec.qty, itemId: spec.item_id })
      }
    }

    for (const [itemId, src] of activeItems.entries()) {
      const moved = movedSums.get(itemId)
      if (!moved || cmpQty(moved, parseQty(src.qty)) !== 0) {
        throw new CommandRejected(
          'STRUCTURAL',
          'VALIDATION_FAILED',
          `Split items must partition 100% of active parent item ${itemId}`,
        )
      }
    }
  }

  // Compute nominal line discount allocations per split spec when an active item with NOMINAL discount splits across children.
  const specLineDiscountByItemId = new Map<string, number | null>()
  if (payload.split_mode !== 'EQUAL') {
    for (const [srcId, srcItem] of activeItems.entries()) {
      const specs = specsBySourceItem.get(srcId) ?? []
      if (srcItem.discountType === 'NOMINAL' && srcItem.discountInput !== null) {
        if (specs.length === 1) {
          specLineDiscountByItemId.set(specs[0]!.itemId, srcItem.discountInput)
        } else {
          const weights = specs.map((sp) => Math.max(1, calcLineGross(toMoney(srcItem.unitPrice), parseQty(sp.qty))))
          const allocs = allocateLR(toMoney(srcItem.discountInput), weights)
          specs.forEach((sp, idx) => specLineDiscountByItemId.set(sp.itemId, allocs[idx]!))
        }
      } else {
        specs.forEach((sp) => specLineDiscountByItemId.set(sp.itemId, null))
      }
    }
  }

  // Compute per-child bill discount for ITEM / QTY splits (PERCENT inherits; NOMINAL allocates LR).
  let childBillNominalDiscounts: readonly (number | null)[] = payload.children.map(
    () => parentState.billDiscountInput,
  )
  if (payload.split_mode !== 'EQUAL' && parentState.billDiscountType === 'NOMINAL' && parentState.billDiscountInput !== null) {
    const childNets = payload.children.map((c) => {
      let sum = 0
      for (const sp of c.items) {
        const src = activeItems.get(sp.source_bill_item_id)!
        const discAmt = specLineDiscountByItemId.get(sp.item_id) ?? src.discountInput
        const mock: BillProjectionItem = {
          ...src,
          qty: sp.qty,
          discountInput: discAmt,
        }
        sum += sumActiveItemNet(mock)
      }
      return sum
    })
    const totalChildNet = childNets.reduce((a, b) => a + b, 0)
    const capped = toMoney(Math.min(parentState.billDiscountInput, totalChildNet))
    if (totalChildNet > 0 && capped > 0) {
      childBillNominalDiscounts = allocateLR(capped, childNets)
    } else {
      childBillNominalDiscounts = payload.children.map(() => 0)
    }
  }

  // 1. Update parent bill -> status = 'SPLIT' (keep splitMode null on EQUAL to satisfy ck_bill__equal_share_fields)
  await tx
    .update(bill)
    .set({
      status: 'SPLIT',
      handoverStatus: 'NONE',
      handoverTargetRegisterId: null,
      handoverEventId: null,
      handoverRequestedAt: null,
      splitMode: payload.split_mode === 'EQUAL' ? null : payload.split_mode,
      lastEventSeq: evt.bill_seq,
      lastEventAt: ctx.receivedAtIso,
    })
    .where(and(eq(bill.tenantId, tenantId), eq(bill.id, parentState.billId)))

  if (payload.split_mode !== 'EQUAL') {
    const movedIds = [...activeItems.keys()]
    await tx
      .update(billItem)
      .set({ status: 'MOVED' })
      .where(and(eq(billItem.tenantId, tenantId), inArray(billItem.id, movedIds)))
  }

  // 2. Insert child bills first, then seq-1 BILL_OPENED events, then child bill_items referencing those events.
  const needsAutoSeq = payload.children.some((c) => c.child_device_seq === undefined)
  let nextFallbackSeq = needsAutoSeq ? (await allocateDeviceSeqBase(tx, tenantId, evt.device_id)) + 1 : 0

  const childInitEvents = payload.children.map((child, i) => {
    const childEventId = child.child_event_id ?? newBillRepoId()
    const tableId = child.table_id ?? parentState.tableId!
    const deviceSeq = child.child_device_seq ?? nextFallbackSeq++
    return {
      child,
      index: i,
      childEventId,
      tableId,
      eventRow: {
        id: childEventId,
        tenantId,
        outletId,
        billId: child.child_bill_id,
        billSeq: 1,
        deviceId: evt.device_id,
        registerId: evt.register_id,
        deviceSeq,
        staffId: evt.staff_id,
        eventType: 'BILL_OPENED',
        payload: {
          table_id: tableId,
          bill_ref: child.child_bill_ref,
          customer_name: child.customer_name !== undefined ? child.customer_name : parentState.customerName,
        },
        reasonCode: null,
        reasonText: null,
        originBillId: parentState.billId,
        originEventIds: [evt.id],
        targetRegisterId: null,
        handoverEventId: null,
        createdAtDevice: evt.created_at_device,
        clockOffsetMs: evt.clock_offset_ms,
        occurredAt: evt.occurred_at,
        businessDate: evt.business_date,
        receivedAt: ctx.receivedAtIso,
        commandId: ctx.commandId,
        schemaVersion: evt.schema_version,
        appVersion: evt.app_version ?? ctx.appVersion,
      },
    }
  })

  for (const entry of childInitEvents) {
    const { child, index, tableId } = entry
    await tx.insert(bill).values({
      id: child.child_bill_id,
      tenantId,
      outletId,
      registerId: ctx.device.registerId,
      deviceId: ctx.device.deviceId,
      createdBy: evt.staff_id,
      createdAtDevice: evt.created_at_device,
      clockOffsetMs: evt.clock_offset_ms,
      occurredAt: evt.occurred_at,
      businessDate: evt.business_date,
      receivedAt: ctx.receivedAtIso,
      commandId: ctx.commandId,
      schemaVersion: evt.schema_version,
      appVersion: evt.app_version ?? ctx.appVersion,
      tableId,
      billRef: child.child_bill_ref,
      status: 'OPEN',
      leaseDeviceId: evt.device_id,
      leaseRegisterId: evt.register_id,
      handoverStatus: 'NONE',
      lastContentSeq: 1,
      parentBillId: parentState.billId,
      splitMode: payload.split_mode,
      shareIndex: payload.split_mode === 'EQUAL' ? (child.share_index ?? index + 1) : null,
      shareCount: payload.split_mode === 'EQUAL' ? (child.share_count ?? payload.children.length) : null,
      billDiscountType: parentState.billDiscountType,
      billDiscountPct: parentState.billDiscountPct,
      billDiscountInput:
        parentState.billDiscountType === 'NOMINAL' ? (childBillNominalDiscounts[index] ?? 0) : null,
      billDiscountApprovedBy: parentState.billDiscountApprovedBy,
      customerName: child.customer_name !== undefined ? child.customer_name : parentState.customerName,
      customerPhone: child.customer_phone !== undefined ? child.customer_phone : parentState.customerPhone,
      lastEventSeq: 1,
      lastEventAt: ctx.receivedAtIso,
    })
  }

  // Insert child seq-1 bill_event rows before child bill_items so fk_bill_item__created_event is satisfied.
  await insertBillEvents(
    tx,
    childInitEvents.map((e) => e.eventRow),
  )

  for (const entry of childInitEvents) {
    const { child, childEventId } = entry
    for (const sp of child.items) {
      const src = activeItems.get(sp.source_bill_item_id)!
      const lineDiscInput = specLineDiscountByItemId.get(sp.item_id) ?? src.discountInput
      await tx.insert(billItem).values({
        id: sp.item_id,
        tenantId,
        outletId,
        billId: child.child_bill_id,
        lineNo: sp.line_no,
        skuId: src.skuId,
        uomId: src.uomId,
        skuCode: src.skuCode,
        itemName: src.itemName,
        uomCode: src.uomCode,
        qty: sp.qty,
        conversionFactor: src.conversionFactor,
        unitPrice: src.unitPrice,
        priceSource: src.priceSource,
        isOpenPrice: src.isOpenPrice,
        taxable: src.taxable,
        discountType: src.discountType,
        discountPct: src.discountPct,
        discountInput: src.discountType === 'NOMINAL' ? lineDiscInput : null,
        discountApprovedBy: src.discountApprovedBy,
        note: src.note,
        status: 'ACTIVE',
        originBillId: parentState.billId,
        originItemId: src.id,
        createdEventId: childEventId,
      })

      if (src.modifiers.length > 0) {
        await tx.insert(billItemModifier).values(
          src.modifiers.map((m) => ({
            id: newBillRepoId(),
            tenantId,
            billItemId: sp.item_id,
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

/**
 * Executes `BILL_MERGED` atomically across target bill and locked source bills.
 */
export async function executeBillMerge(
  tx: TenantTx,
  ctx: CommandContext,
  params: {
    targetState: BillProjectionState
    targetRow: BillRow | null
    evt: BillEventEnvelopeV1
    lockedBills: ReadonlyMap<string, BillRow>
    sourceStates: ReadonlyMap<string, BillProjectionState>
  },
): Promise<void> {
  const { targetState, targetRow, evt, lockedBills, sourceStates } = params
  const tenantId = ctx.device.tenantId
  const outletId = ctx.device.outletId
  const payload = BillMergedPayloadSchema.parse(evt.payload)

  if (targetState.status !== 'OPEN') {
    throw new CommandRejected('STRUCTURAL', 'BILL_CLOSED', `Target bill ${targetState.billId} is ${targetState.status}`)
  }
  if (targetState.handoverStatus === 'PENDING') {
    throw new CommandRejected('AUTHORIZATION', 'BILL_READ_ONLY', 'Target bill is pending handover')
  }
  if (targetRow?.parentBillId) {
    throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', 'Split child bills cannot merge')
  }

  const incomingItems: {
    originBillId: string
    originItemId: string
    newItemId: string
    item: BillProjectionItem
  }[] = []
  const movedSourceItemIds: string[] = []
  const sourceAuditEvents = []
  const needsAutoMergeSeq = payload.source_bill_ids.some(
    (id) => payload.source_device_seqs?.[id] === undefined,
  )
  let nextFallbackMergeSeq = needsAutoMergeSeq
    ? (await allocateDeviceSeqBase(tx, tenantId, evt.device_id)) + 1
    : 0

  for (const srcId of payload.source_bill_ids) {
    if (srcId === targetState.billId) {
      throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', 'Cannot merge a bill into itself')
    }
    const srcRow = lockedBills.get(srcId)
    const srcState = sourceStates.get(srcId)
    if (!srcRow || !srcState) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown source bill_id ${srcId}`)
    }
    if (srcRow.outletId !== outletId) {
      throw new CommandRejected('AUTHORIZATION', 'FORBIDDEN', 'Source bill belongs to another outlet')
    }
    if (srcRow.status !== 'OPEN') {
      throw new CommandRejected('STRUCTURAL', 'BILL_CLOSED', `Source bill ${srcId} is ${srcRow.status}`)
    }
    if (srcRow.handoverStatus === 'PENDING') {
      throw new CommandRejected('AUTHORIZATION', 'BILL_READ_ONLY', `Source bill ${srcId} is pending handover`)
    }
    if (srcRow.leaseDeviceId !== ctx.device.deviceId) {
      throw new CommandRejected(
        'AUTHORIZATION',
        'NOT_LEASE_HOLDER',
        `Device does not hold lease for source bill ${srcId}`,
      )
    }
    if (srcRow.parentBillId !== null) {
      throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', 'Split child bills cannot be merged')
    }

    for (const item of srcState.items.values()) {
      if (item.status === 'ACTIVE') {
        movedSourceItemIds.push(item.id)
        incomingItems.push({
          originBillId: srcId,
          originItemId: item.id,
          newItemId: payload.moved_item_targets?.[item.id] ?? newBillRepoId(),
          item,
        })
      }
    }

    const nextSrcSeq = srcRow.lastEventSeq + 1
    await tx
      .update(bill)
      .set({
        status: 'MERGED',
        mergedIntoBillId: targetState.billId,
        handoverStatus: 'NONE',
        handoverTargetRegisterId: null,
        handoverEventId: null,
        handoverRequestedAt: null,
        lastEventSeq: nextSrcSeq,
        lastEventAt: ctx.receivedAtIso,
        closedAt: evt.occurred_at,
      })
      .where(and(eq(bill.tenantId, tenantId), eq(bill.id, srcId)))

    sourceAuditEvents.push({
      id: payload.source_event_ids?.[srcId] ?? newBillRepoId(),
      tenantId,
      outletId,
      billId: srcId,
      billSeq: nextSrcSeq,
      deviceId: evt.device_id,
      registerId: evt.register_id,
      deviceSeq: payload.source_device_seqs?.[srcId] ?? nextFallbackMergeSeq++,
      staffId: evt.staff_id,
      eventType: 'BILL_MERGED',
      payload: {
        source_bill_ids: [srcId],
      },
      reasonCode: null,
      reasonText: null,
      originBillId: targetState.billId,
      originEventIds: [evt.id],
      targetRegisterId: null,
      handoverEventId: null,
      createdAtDevice: evt.created_at_device,
      clockOffsetMs: evt.clock_offset_ms,
      occurredAt: evt.occurred_at,
      businessDate: evt.business_date,
      receivedAt: ctx.receivedAtIso,
      commandId: ctx.commandId,
      schemaVersion: evt.schema_version,
      appVersion: evt.app_version ?? ctx.appVersion,
    })
  }

  if (movedSourceItemIds.length > 0) {
    await tx
      .update(billItem)
      .set({ status: 'MOVED' })
      .where(and(eq(billItem.tenantId, tenantId), inArray(billItem.id, movedSourceItemIds)))
  }

  const originByNewId = new Map(incomingItems.map((inc) => [inc.newItemId, inc] as const))
  const merged = mergeSimilarItems([...targetState.items.values()], incomingItems)

  for (const upd of merged.updatedExisting) {
    await tx
      .update(billItem)
      .set({ qty: upd.nextQty })
      .where(and(eq(billItem.tenantId, tenantId), eq(billItem.id, upd.id)))
  }

  for (const added of merged.insertedNew) {
    const srcMeta = originByNewId.get(added.id)
    await tx.insert(billItem).values({
      id: added.id,
      tenantId,
      outletId,
      billId: targetState.billId,
      lineNo: added.lineNo,
      skuId: added.skuId,
      uomId: added.uomId,
      skuCode: added.skuCode,
      itemName: added.itemName,
      uomCode: added.uomCode,
      qty: added.qty,
      conversionFactor: added.conversionFactor,
      unitPrice: added.unitPrice,
      priceSource: added.priceSource,
      isOpenPrice: added.isOpenPrice,
      taxable: added.taxable,
      discountType: added.discountType,
      discountPct: added.discountPct,
      discountInput: added.discountInput,
      discountApprovedBy: added.discountApprovedBy,
      note: added.note,
      status: 'ACTIVE',
      originBillId: srcMeta?.originBillId ?? null,
      originItemId: srcMeta?.originItemId ?? null,
      createdEventId: evt.id,
    })

    if (added.modifiers.length > 0) {
      await tx.insert(billItemModifier).values(
        added.modifiers.map((m) => ({
          id: newBillRepoId(),
          tenantId,
          billItemId: added.id,
          modifierId: m.modifierId,
          name: m.name,
          priceDelta: m.priceDelta,
          qty: m.qty,
        })),
      )
    }
  }

  await tx
    .update(bill)
    .set({
      lastContentSeq: evt.bill_seq,
      lastEventSeq: evt.bill_seq,
      lastEventAt: ctx.receivedAtIso,
    })
    .where(and(eq(bill.tenantId, tenantId), eq(bill.id, targetState.billId)))

  await insertBillEvents(tx, sourceAuditEvents)
}
