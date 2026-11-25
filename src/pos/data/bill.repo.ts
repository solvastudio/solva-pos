import { liveQuery, type Observable, type Table, type Transaction } from 'dexie'
import { APP_VERSION } from '~/lib/app-version'
import {
  AppendAuditPayloadV1,
  SCHEMA_VERSION,
  type AppendBillEventsPayloadV1,
  type BillItemModifierInput,
  type BillSplitChildSpec,
} from '~/lib/contracts'
import {
  allocateLR,
  businessDate,
  createIdGenerator,
  parseQty,
  qtyToBase,
  toMoney,
  ZERO,
  type OutletTimezone,
} from '~/lib/kernel'
import { calcLineDiscount, calcLineGross } from '~/lib/sales-calc'
import {
  applyBillEvent,
  computeModifierDeltaSum,
  emptyBill,
  isAwaitingPayment,
  mergeSimilarItems,
  type BillEventEnvelopeV1,
  type BillProjectionItem,
  type BillProjectionState,
} from '~/modules/fnb/shared'
import type { SolvaDb } from '../db/solva-db'
import type {
  BillEventRecord,
  BillItemModifierRecord,
  BillItemRecord,
  BillRecord,
  FnbTableRecord,
  LocalCounterRow,
  MetaValueMap,
  OutboxCommandRow,
  OutletRecord,
  PrintJobRecord,
} from '../db/types'
import { billSeqCounterKey, DEVICE_SEQ_KEY, nextSeq } from './counter.repo'
import { canAddItem, canEditBill } from '../domain/bill-guards'
import { nextBillRef } from '../domain/bill-ref'
import type { ResolvedCartItem } from '../domain/cart'
import { enqueueCommand } from './outbox.repo'
import { enqueuePrintJob } from './print-job.repo'
import { trustedNowMs } from '../session/device-state'
import { kickActiveSync } from '../sync'

const defaultIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})

export type BillRepoErrorCode =
  | 'DEVICE_NOT_PAIRED'
  | 'OUTLET_NOT_FOUND'
  | 'TABLE_NOT_FOUND'
  | 'BILL_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'READ_ONLY_OTHER'
  | 'READ_ONLY_PENDING'
  | 'BILL_CLOSED'
  | 'CANNOT_EDIT'
  | 'ITEM_UNAVAILABLE'
  | 'NO_PRICE'
  | 'INVALID_PRICE'
  | 'INVALID_QTY'
  | 'BILL_HAS_ACTIVE_ITEMS'
  | 'VOID_REASON_REQUIRED'

export class BillRepoError extends Error {
  constructor(
    public readonly code: BillRepoErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BillRepoError'
  }
}

export interface LocalBillWithItems {
  readonly bill: BillRecord
  readonly items: readonly (BillItemRecord & { readonly modifiers: readonly BillItemModifierRecord[] })[]
}

export async function listLocalBills(db: SolvaDb): Promise<BillRecord[]> {
  return db.bill.toArray()
}

export function observeLocalBills(db: SolvaDb): Observable<BillRecord[]> {
  return liveQuery(() => db.bill.toArray())
}

export async function getLocalBillWithItems(
  db: SolvaDb,
  billId: string,
): Promise<LocalBillWithItems | null> {
  const bill = await db.bill.get(billId)
  if (!bill) return null
  const items = await db.bill_item.where('bill_id').equals(billId).sortBy('line_no')
  const itemIds = items.map((i) => i.id)
  const mods =
    itemIds.length > 0
      ? await db.bill_item_modifier.where('bill_item_id').anyOf(itemIds).toArray()
      : []
  const modsByItem = new Map<string, BillItemModifierRecord[]>()
  for (const m of mods) {
    const arr = modsByItem.get(m.bill_item_id) ?? []
    arr.push(m)
    modsByItem.set(m.bill_item_id, arr)
  }
  return {
    bill,
    items: items.map((it) => ({
      ...it,
      modifiers: modsByItem.get(it.id) ?? [],
    })),
  }
}

export function observeLocalBillWithItems(
  db: SolvaDb,
  billId: string,
): Observable<LocalBillWithItems | null> {
  return liveQuery(() => getLocalBillWithItems(db, billId))
}

export async function listBillEventsForBill(db: SolvaDb, billId: string): Promise<BillEventRecord[]> {
  const rows = await db.bill_event.where('bill_id').equals(billId).toArray()
  return rows.sort((a, b) => a.bill_seq - b.bill_seq)
}

function toProjectionStateFromLocal(
  b: BillRecord,
  items: readonly BillItemRecord[],
  modsByItem: ReadonlyMap<string, readonly BillItemModifierRecord[]>,
): BillProjectionState {
  const map = new Map<string, BillProjectionItem>()
  for (const it of items) {
    map.set(it.id, {
      id: it.id,
      lineNo: it.line_no,
      skuId: it.sku_id,
      uomId: it.uom_id,
      skuCode: it.sku_code,
      itemName: it.item_name,
      uomCode: it.uom_code,
      qty: it.qty,
      conversionFactor: it.conversion_factor,
      unitPrice: it.unit_price,
      priceSource: it.price_source,
      isOpenPrice: it.is_open_price,
      taxable: it.taxable,
      discountType: it.discount_type,
      discountPct: it.discount_pct,
      discountInput: it.discount_input,
      discountApprovedBy: it.discount_approved_by,
      note: it.note,
      status: it.status,
      voidReasonCode: it.void_reason_code ?? null,
      voidReasonText: it.void_reason_text ?? null,
      createdEventId: it.created_event_id,
      modifiers: (modsByItem.get(it.id) ?? []).map((m) => ({
        modifierId: m.modifier_id,
        name: m.name,
        priceDelta: m.price_delta,
        qty: m.qty,
      })),
    })
  }
  return {
    billId: b.id,
    status: b.status,
    tableId: b.table_id,
    billRef: b.bill_ref,
    leaseDeviceId: b.lease_device_id,
    leaseRegisterId: b.lease_register_id,
    handoverStatus: b.handover_status,
    handoverTargetRegisterId: b.handover_target_register_id,
    handoverEventId: b.handover_event_id,
    handoverRequestedAt: b.handover_requested_at,
    prebillSeq: b.prebill_seq,
    prebillPrintedAt: b.prebill_printed_at,
    lastContentSeq: b.last_content_seq,
    splitMode: b.split_mode,
    billDiscountType: b.bill_discount_type,
    billDiscountPct: b.bill_discount_pct,
    billDiscountInput: b.bill_discount_input,
    billDiscountApprovedBy: b.bill_discount_approved_by,
    customerName: b.customer_name,
    customerPhone: b.customer_phone,
    lastEventSeq: b.last_event_seq,
    lastEventAt: b.last_event_at,
    closedAt: b.closed_at,
    items: map,
    appliedEventIds: new Set(),
  }
}

async function applyProjectionInTx(
  tx: Transaction,
  params: {
    baseBill: Partial<BillRecord>
    prevState: BillProjectionState
    nextState: BillProjectionState
    productIdsByItemId?: ReadonlyMap<string, string | null>
  },
): Promise<BillRecord> {
  const { prevState, nextState } = params
  const billTable: Table<BillRecord, string> = tx.table('bill')
  const itemTable: Table<BillItemRecord, string> = tx.table('bill_item')
  const modTable: Table<BillItemModifierRecord, string> = tx.table('bill_item_modifier')

  const record: BillRecord = {
    id: nextState.billId,
    tenant_id: params.baseBill.tenant_id!,
    outlet_id: params.baseBill.outlet_id!,
    register_id: params.baseBill.register_id!,
    device_id: params.baseBill.device_id!,
    table_id: nextState.tableId!,
    bill_ref: nextState.billRef!,
    status: nextState.status === 'UNOPENED' ? 'OPEN' : nextState.status,
    lease_device_id: nextState.leaseDeviceId!,
    lease_register_id: nextState.leaseRegisterId!,
    handover_status: nextState.handoverStatus,
    handover_target_register_id: nextState.handoverTargetRegisterId,
    handover_event_id: nextState.handoverEventId,
    handover_requested_at: nextState.handoverRequestedAt,
    prebill_seq: nextState.prebillSeq,
    prebill_printed_at: nextState.prebillPrintedAt,
    last_content_seq: nextState.lastContentSeq,
    is_awaiting_payment: isAwaitingPayment(nextState),
    split_mode: nextState.splitMode,
    parent_bill_id: params.baseBill.parent_bill_id ?? null,
    share_index: params.baseBill.share_index ?? null,
    share_count: params.baseBill.share_count ?? null,
    bill_discount_type: nextState.billDiscountType,
    bill_discount_pct: nextState.billDiscountPct,
    bill_discount_input: nextState.billDiscountInput,
    bill_discount_approved_by: nextState.billDiscountApprovedBy,
    customer_name: nextState.customerName,
    customer_phone: nextState.customerPhone,
    last_event_seq: nextState.lastEventSeq,
    last_event_at: nextState.lastEventAt,
    created_by: params.baseBill.created_by!,
    created_at_device: params.baseBill.created_at_device!,
    occurred_at: params.baseBill.occurred_at!,
    business_date: params.baseBill.business_date!,
    closed_at: nextState.closedAt,
    sync_status: 'PENDING',
  }

  await billTable.put(record)

  for (const [itemId, nextItem] of nextState.items.entries()) {
    const prevItem = prevState.items.get(itemId)
    if (!prevItem) {
      await itemTable.put({
        id: nextItem.id,
        bill_id: nextState.billId,
        line_no: nextItem.lineNo,
        product_id: params.productIdsByItemId?.get(itemId) ?? null,
        sku_id: nextItem.skuId,
        uom_id: nextItem.uomId,
        sku_code: nextItem.skuCode,
        item_name: nextItem.itemName,
        uom_code: nextItem.uomCode,
        qty: nextItem.qty,
        conversion_factor: nextItem.conversionFactor,
        unit_price: nextItem.unitPrice,
        price_source: nextItem.priceSource,
        is_open_price: nextItem.isOpenPrice,
        taxable: nextItem.taxable,
        discount_type: nextItem.discountType,
        discount_pct: nextItem.discountPct,
        discount_input: nextItem.discountInput,
        discount_approved_by: nextItem.discountApprovedBy,
        note: nextItem.note,
        status: nextItem.status,
        void_reason_code: nextItem.voidReasonCode,
        void_reason_text: nextItem.voidReasonText,
        created_event_id: nextItem.createdEventId,
      })
      if (nextItem.modifiers.length > 0) {
        await modTable.bulkPut(
          nextItem.modifiers.map((m) => ({
            id: `${nextItem.id}:${m.modifierId}`,
            bill_item_id: nextItem.id,
            modifier_id: m.modifierId,
            name: m.name,
            price_delta: m.priceDelta,
            qty: m.qty,
          })),
        )
      }
    } else if (prevItem !== nextItem) {
      await itemTable.update(itemId, {
        qty: nextItem.qty,
        unit_price: nextItem.unitPrice,
        discount_type: nextItem.discountType,
        discount_pct: nextItem.discountPct,
        discount_input: nextItem.discountInput,
        discount_approved_by: nextItem.discountApprovedBy,
        status: nextItem.status,
        void_reason_code: nextItem.voidReasonCode,
        void_reason_text: nextItem.voidReasonText,
      })
      if (prevItem.modifiers !== nextItem.modifiers) {
        await modTable.where('bill_item_id').equals(itemId).delete()
        if (nextItem.modifiers.length > 0) {
          await modTable.bulkPut(
            nextItem.modifiers.map((m) => ({
              id: `${nextItem.id}:${m.modifierId}`,
              bill_item_id: nextItem.id,
              modifier_id: m.modifierId,
              name: m.name,
              price_delta: m.priceDelta,
              qty: m.qty,
            })),
          )
        }
      }
    }
  }

  return record
}

export interface BillMutationDeps {
  readonly nowMs?: () => number
  readonly newId?: () => string
  readonly beforeCommitHookForTest?: () => Promise<void> | void
}

async function readEnvForBillAction(db: SolvaDb, deps: BillMutationDeps) {
  const [device, clock] = await Promise.all([db.meta.get('device'), db.meta.get('clock')])
  const devMeta = device?.value as MetaValueMap['device'] | undefined
  if (!devMeta) throw new BillRepoError('DEVICE_NOT_PAIRED', 'Device is not paired')
  const outlet = (await db.outlet.get(devMeta.outlet_id)) as OutletRecord | undefined
  if (!outlet || outlet.deleted_at) throw new BillRepoError('OUTLET_NOT_FOUND', 'Outlet missing')

  const clockVal = clock?.value as MetaValueMap['clock'] | undefined
  const nowMs = (deps.nowMs ?? Date.now)()
  const offsetMs = clockVal?.offset_ms ?? 0
  const maxSeenMs = clockVal ? Date.parse(clockVal.max_seen_time) || 0 : 0
  const correctedMs = trustedNowMs({ nowMs, clockOffsetMs: offsetMs, maxSeenMs })

  const createdAtDevice = new Date(nowMs).toISOString()
  const occurredAt = new Date(correctedMs).toISOString()
  const bDate = businessDate(
    occurredAt,
    outlet.timezone as OutletTimezone,
    outlet.day_cutoff_time.slice(0, 5),
  )

  const cleanAppVer = APP_VERSION.slice(0, 30)
  const appVersion = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(cleanAppVer)
    ? cleanAppVer
    : null

  return {
    device: devMeta,
    outlet,
    offsetMs,
    createdAtDevice,
    occurredAt,
    businessDate: bDate,
    appVersion,
    newId: deps.newId ?? (() => defaultIdGen.newId()),
  }
}

async function appendLocalEventsTx(
  db: SolvaDb,
  deps: BillMutationDeps,
  params: {
    billId: string
    staffId: string
    auditApproval?: {
      action: string
      approverId: string
      reasonCode?: string | null
      reasonText?: string | null
      beforeData?: Record<string, unknown> | null
      afterData?: Record<string, unknown> | null
    }
    prebillPrintJob?: Omit<PrintJobRecord, 'id' | 'entity_id' | 'entity_type'> | null
    buildEvents: (ctx: {
      tx: Transaction
      prevState: BillProjectionState
      baseBill: Partial<BillRecord>
      nextBillSeq: () => Promise<number>
      nextDeviceSeq: () => Promise<number>
      env: Awaited<ReturnType<typeof readEnvForBillAction>>
    }) => Promise<{
      events: BillEventEnvelopeV1[]
      baseBill: Partial<BillRecord>
      productIdsByItemId?: Map<string, string | null>
    }>
  },
): Promise<{ bill: BillRecord; events: BillEventEnvelopeV1[] }> {
  const env = await readEnvForBillAction(db, deps)

  const stores = [
    db.bill,
    db.bill_item,
    db.bill_item_modifier,
    db.bill_event,
    db.outbox_command,
    db.local_counter,
    db.fnb_table,
    ...(params.prebillPrintJob ? [db.print_job] : []),
  ]

  const result = await db.transaction('rw', stores, async (tx) => {
    const billTable: Table<BillRecord, string> = tx.table('bill')
    const itemTable: Table<BillItemRecord, string> = tx.table('bill_item')
    const modTable: Table<BillItemModifierRecord, string> = tx.table('bill_item_modifier')
    const eventTable: Table<BillEventRecord, string> = tx.table('bill_event')

    const existing = await billTable.get(params.billId)
    let prevState: BillProjectionState
    let baseBill: Partial<BillRecord>

    if (existing) {
      const check = canEditBill(existing, env.device.device_id)
      if (!check.ok) {
        if (check.reason === 'CLOSED') throw new BillRepoError('BILL_CLOSED', 'Bill is closed')
        if (check.reason === 'READ_ONLY_PENDING') {
          throw new BillRepoError('READ_ONLY_PENDING', 'Bill handover is pending')
        }
        throw new BillRepoError('READ_ONLY_OTHER', 'Bill is held by another device')
      }
      const existingItems = await itemTable.where('bill_id').equals(params.billId).toArray()
      const itemIds = existingItems.map((i) => i.id)
      const mods =
        itemIds.length > 0 ? await modTable.where('bill_item_id').anyOf(itemIds).toArray() : []
      const modsByItem = new Map<string, BillItemModifierRecord[]>()
      for (const m of mods) {
        const arr = modsByItem.get(m.bill_item_id) ?? []
        arr.push(m)
        modsByItem.set(m.bill_item_id, arr)
      }
      prevState = toProjectionStateFromLocal(existing, existingItems, modsByItem)
      baseBill = existing
    } else {
      prevState = emptyBill(params.billId)
      baseBill = {
        tenant_id: env.device.tenant_id,
        outlet_id: env.device.outlet_id,
        register_id: env.device.register_id,
        device_id: env.device.device_id,
        created_by: params.staffId,
        created_at_device: env.createdAtDevice,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
      }
    }

    const built = await params.buildEvents({
      tx,
      prevState,
      baseBill,
      nextBillSeq: () =>
        nextSeq(tx, billSeqCounterKey(params.billId), {
          registerId: env.device.register_id,
          docType: 'BILL_SEQ',
          updatedAt: env.createdAtDevice,
        }),
      nextDeviceSeq: () =>
        nextSeq(tx, DEVICE_SEQ_KEY, {
          registerId: env.device.register_id,
          updatedAt: env.createdAtDevice,
        }),
      env,
    })

    let nextState = prevState
    for (const evt of built.events) {
      nextState = applyBillEvent(nextState, evt)
    }

    for (const evt of built.events) {
      await eventTable.add({
        id: evt.id,
        bill_id: evt.bill_id,
        bill_seq: evt.bill_seq,
        device_id: evt.device_id,
        register_id: evt.register_id,
        device_seq: evt.device_seq,
        staff_id: evt.staff_id,
        event_type: evt.event_type,
        payload: evt.payload,
        reason_code: evt.reason_code ?? null,
        reason_text: evt.reason_text ?? null,
        created_at_device: evt.created_at_device,
        clock_offset_ms: evt.clock_offset_ms,
        occurred_at: evt.occurred_at,
        business_date: evt.business_date,
        schema_version: evt.schema_version,
        app_version: evt.app_version ?? null,
      })
    }

    const updatedBill = await applyProjectionInTx(tx, {
      baseBill: built.baseBill,
      prevState,
      nextState,
      productIdsByItemId: built.productIdsByItemId,
    })

    const cmdId = env.newId()
    const payload: AppendBillEventsPayloadV1 = {
      bill_id: params.billId,
      events: built.events,
    }
    let dependsOn: string[] | undefined
    if (built.baseBill.parent_bill_id) {
      const parentPending = await tx
        .table<OutboxCommandRow, string>('outbox_command')
        .where('dependency_key')
        .equals(`bill:${built.baseBill.parent_bill_id}`)
        .toArray()
      const latestParent = parentPending
        .filter((c) => c.status !== 'ACKED' && c.status !== 'DISMISSED')
        .sort((a, b) => b.device_seq - a.device_seq)[0]
      if (latestParent) dependsOn = [latestParent.id]
    }
    await enqueueCommand(tx, {
      id: cmdId,
      type: 'AppendBillEvents',
      payload,
      schemaVersion: SCHEMA_VERSION,
      registerId: env.device.register_id,
      dependencyKey: `bill:${params.billId}`,
      ...(dependsOn ? { dependsOn } : {}),
      createdAtDevice: env.createdAtDevice,
    })

    if (params.auditApproval) {
      const auditId = env.newId()
      const auditPayload = AppendAuditPayloadV1.parse({
        entry: {
          id: auditId,
          action: params.auditApproval.action,
          entity_type: 'bill',
          entity_id: params.billId,
          before_data: params.auditApproval.beforeData ?? null,
          after_data: params.auditApproval.afterData ?? null,
          reason_code: params.auditApproval.reasonCode ?? null,
          reason_text: params.auditApproval.reasonText ?? null,
          actor_user_id: params.staffId,
          approver_user_id: params.auditApproval.approverId,
          occurred_at_device: env.createdAtDevice,
          occurred_at: env.occurredAt,
          business_date: env.businessDate,
          related_command_id: cmdId,
        },
      })
      await enqueueCommand(tx, {
        id: auditId,
        type: 'AppendAudit',
        payload: auditPayload,
        schemaVersion: SCHEMA_VERSION,
        registerId: env.device.register_id,
        dependencyKey: `audit:${params.billId}`,
        dependsOn: [cmdId],
        createdAtDevice: env.createdAtDevice,
      })
    }

    if (params.prebillPrintJob) {
      await enqueuePrintJob(tx, {
        id: env.newId(),
        entity_id: params.billId,
        entity_type: 'BILL',
        ...params.prebillPrintJob,
      })
    }

    if (deps.beforeCommitHookForTest) {
      await deps.beforeCommitHookForTest()
    }

    return { bill: updatedBill, events: built.events }
  })

  kickActiveSync('manual')
  return result
}

export async function openBill(
  db: SolvaDb,
  input: {
    billId?: string
    tableId: string
    staffId: string
    customer?: { name?: string; phone?: string }
  },
  deps: BillMutationDeps = {},
): Promise<{ bill: BillRecord; event: BillEventEnvelopeV1 }> {
  const newId = deps.newId ?? (() => defaultIdGen.newId())
  const billId = input.billId ?? newId()

  const res = await appendLocalEventsTx(db, { ...deps, newId }, {
    billId,
    staffId: input.staffId,
    buildEvents: async ({ tx, prevState, baseBill, nextBillSeq, nextDeviceSeq, env }) => {
      if (prevState.status !== 'UNOPENED') {
        throw new BillRepoError('BILL_CLOSED', 'Bill already exists')
      }
      const table = (await tx.table<FnbTableRecord, string>('fnb_table').get(input.tableId))
      if (!table || table.deleted_at || !table.is_active) {
        throw new BillRepoError('TABLE_NOT_FOUND', 'Table not found')
      }
      const billRef = await nextBillRef(tx, {
        tableId: table.id,
        tableCode: table.code,
        deviceId: env.device.device_id,
        registerId: env.device.register_id,
        updatedAt: env.createdAtDevice,
      })
      const billSeq = await nextBillSeq()
      const deviceSeq = await nextDeviceSeq()
      const evt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: billId,
        bill_seq: billSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        event_type: 'BILL_OPENED',
        payload: {
          table_id: table.id,
          bill_ref: billRef,
          ...(input.customer?.name ? { customer_name: input.customer.name.slice(0, 80) } : {}),
          ...(input.customer?.phone ? { customer_phone: input.customer.phone.slice(0, 20) } : {}),
        },
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }
      return { events: [evt], baseBill }
    },
  })
  return { bill: res.bill, event: res.events[0]! }
}

export async function addBillItem(
  db: SolvaDb,
  input: {
    billId: string
    itemId?: string
    item: ResolvedCartItem
    isAvailable: boolean
    qtyInput?: string
    openPriceOverride?: number
    modifiers?: readonly BillItemModifierInput[]
    note?: string | null
    staffId: string
  },
  deps: BillMutationDeps = {},
): Promise<{ bill: BillRecord; itemId: string; event: BillEventEnvelopeV1 }> {
  const availCheck = canAddItem(input.isAvailable)
  if (!availCheck.ok) {
    throw new BillRepoError('ITEM_UNAVAILABLE', 'Menu item is currently unavailable')
  }
  if (input.item.price.kind === 'NO_PRICE') {
    throw new BillRepoError('NO_PRICE', 'Item has no active price')
  }

  let baseUnitPrice = toMoney(0)
  let priceSource: 'OUTLET' | 'TENANT_DEFAULT' | 'OPEN_PRICE'
  const isOpenPrice = input.item.price.kind === 'OPEN_PRICE'
  if (input.item.price.kind === 'OPEN_PRICE') {
    const chosen = input.openPriceOverride
    if (chosen === undefined || !Number.isSafeInteger(chosen) || chosen <= 0) {
      throw new BillRepoError('INVALID_PRICE', 'Invalid open price amount')
    }
    baseUnitPrice = toMoney(chosen)
    priceSource = 'OPEN_PRICE'
  } else {
    baseUnitPrice = input.item.price.price
    priceSource = input.item.price.source === 'OUTLET' ? 'OUTLET' : 'TENANT_DEFAULT'
  }

  let qtyParsed: string
  let factorParsed: string
  try {
    const q = parseQty((input.qtyInput ?? '1').trim().replace(',', '.'))
    const f = parseQty(String(input.item.conversionFactor))
    qtyToBase({ qty: q, factor: f, allowFraction: input.item.allowFraction })
    qtyParsed = q
    factorParsed = f
  } catch {
    throw new BillRepoError('INVALID_QTY', 'Invalid item quantity')
  }

  const mods = [...(input.modifiers ?? [])]
  const deltaSum = computeModifierDeltaSum(mods)
  const unitPrice = toMoney(Math.max(0, baseUnitPrice + deltaSum))
  const newId = deps.newId ?? (() => defaultIdGen.newId())
  const itemId = input.itemId ?? newId()

  const res = await appendLocalEventsTx(db, { ...deps, newId }, {
    billId: input.billId,
    staffId: input.staffId,
    buildEvents: async ({ prevState, baseBill, nextBillSeq, nextDeviceSeq, env }) => {
      if (prevState.status !== 'OPEN') {
        throw new BillRepoError('BILL_NOT_FOUND', 'Bill is not open')
      }
      let maxLineNo = 0
      for (const existing of prevState.items.values()) {
        if (existing.lineNo > maxLineNo) maxLineNo = existing.lineNo
      }
      const billSeq = await nextBillSeq()
      const deviceSeq = await nextDeviceSeq()
      const displayName = input.item.variantLabel
        ? `${input.item.itemName} — ${input.item.variantLabel}`
        : input.item.itemName
      const evt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: input.billId,
        bill_seq: billSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        event_type: 'ITEM_ADDED',
        payload: {
          item_id: itemId,
          line_no: maxLineNo + 1,
          sku_id: input.item.skuId,
          uom_id: input.item.uomId,
          sku_code: input.item.skuCode,
          item_name: displayName,
          uom_code: input.item.uomCode,
          qty: qtyParsed,
          conversion_factor: factorParsed,
          unit_price: unitPrice,
          base_unit_price: baseUnitPrice,
          price_source: priceSource,
          is_open_price: isOpenPrice,
          taxable: input.item.taxable,
          note: input.note ? input.note.slice(0, 200) : null,
          modifiers: mods,
        },
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }
      return {
        events: [evt],
        baseBill,
        productIdsByItemId: new Map([[itemId, input.item.productId]]),
      }
    },
  })
  return { bill: res.bill, itemId, event: res.events[0]! }
}

export async function changeBillItemQty(
  db: SolvaDb,
  input: { billId: string; itemId: string; qtyInput: string; allowFraction?: boolean; staffId: string },
  deps: BillMutationDeps = {},
): Promise<{ bill: BillRecord; event: BillEventEnvelopeV1 }> {
  let qtyParsed: string
  try {
    const q = parseQty(input.qtyInput.trim().replace(',', '.'))
    qtyParsed = q
  } catch {
    throw new BillRepoError('INVALID_QTY', 'Invalid item quantity')
  }

  const res = await appendLocalEventsTx(db, deps, {
    billId: input.billId,
    staffId: input.staffId,
    buildEvents: async ({ prevState, baseBill, nextBillSeq, nextDeviceSeq, env }) => {
      const target = prevState.items.get(input.itemId)
      if (!target || target.status !== 'ACTIVE') {
        throw new BillRepoError('ITEM_NOT_FOUND', 'Active bill item not found')
      }
      const billSeq = await nextBillSeq()
      const deviceSeq = await nextDeviceSeq()
      const evt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: input.billId,
        bill_seq: billSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        event_type: 'ITEM_QTY_CHANGED',
        payload: { item_id: input.itemId, qty: qtyParsed },
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }
      return { events: [evt], baseBill }
    },
  })
  return { bill: res.bill, event: res.events[0]! }
}

export async function voidBillItem(
  db: SolvaDb,
  input: { billId: string; itemId: string; reasonText: string; reasonCode?: string | null; staffId: string },
  deps: BillMutationDeps = {},
): Promise<{ bill: BillRecord; event: BillEventEnvelopeV1 }> {
  const cleanReason = input.reasonText.trim()
  if (!cleanReason) {
    throw new BillRepoError('VOID_REASON_REQUIRED', 'Void reason is required')
  }

  const res = await appendLocalEventsTx(db, deps, {
    billId: input.billId,
    staffId: input.staffId,
    buildEvents: async ({ prevState, baseBill, nextBillSeq, nextDeviceSeq, env }) => {
      const target = prevState.items.get(input.itemId)
      if (!target || target.status !== 'ACTIVE') {
        throw new BillRepoError('ITEM_NOT_FOUND', 'Active bill item not found')
      }
      const billSeq = await nextBillSeq()
      const deviceSeq = await nextDeviceSeq()
      const evt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: input.billId,
        bill_seq: billSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        event_type: 'ITEM_VOIDED',
        payload: { item_id: input.itemId },
        reason_code: input.reasonCode ?? null,
        reason_text: cleanReason.slice(0, 200),
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }
      return { events: [evt], baseBill }
    },
  })
  return { bill: res.bill, event: res.events[0]! }
}

export async function setBillItemModifiers(
  db: SolvaDb,
  input: { billId: string; itemId: string; modifiers: readonly BillItemModifierInput[]; staffId: string },
  deps: BillMutationDeps = {},
): Promise<{ bill: BillRecord; event: BillEventEnvelopeV1 }> {
  const res = await appendLocalEventsTx(db, deps, {
    billId: input.billId,
    staffId: input.staffId,
    buildEvents: async ({ prevState, baseBill, nextBillSeq, nextDeviceSeq, env }) => {
      const target = prevState.items.get(input.itemId)
      if (!target || target.status !== 'ACTIVE') {
        throw new BillRepoError('ITEM_NOT_FOUND', 'Active bill item not found')
      }
      const oldDelta = computeModifierDeltaSum(
        target.modifiers.map((m) => ({
          modifier_id: m.modifierId,
          name: m.name,
          price_delta: m.priceDelta,
          qty: m.qty,
        })),
      )
      const baseUnitPrice = toMoney(Math.max(0, target.unitPrice - oldDelta))
      const newDelta = computeModifierDeltaSum(input.modifiers)
      const unitPrice = toMoney(Math.max(0, baseUnitPrice + newDelta))

      const billSeq = await nextBillSeq()
      const deviceSeq = await nextDeviceSeq()
      const evt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: input.billId,
        bill_seq: billSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        event_type: 'MODIFIER_SET',
        payload: {
          item_id: input.itemId,
          modifiers: [...input.modifiers],
          unit_price: unitPrice,
          base_unit_price: baseUnitPrice,
        },
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }
      return { events: [evt], baseBill }
    },
  })
  return { bill: res.bill, event: res.events[0]! }
}

export async function setBillCustomer(
  db: SolvaDb,
  input: { billId: string; customerName?: string | null; customerPhone?: string | null; staffId: string },
  deps: BillMutationDeps = {},
): Promise<{ bill: BillRecord; event: BillEventEnvelopeV1 }> {
  const res = await appendLocalEventsTx(db, deps, {
    billId: input.billId,
    staffId: input.staffId,
    buildEvents: async ({ baseBill, nextBillSeq, nextDeviceSeq, env }) => {
      const billSeq = await nextBillSeq()
      const deviceSeq = await nextDeviceSeq()
      const evt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: input.billId,
        bill_seq: billSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        event_type: 'CUSTOMER_SET',
        payload: {
          name: input.customerName ? input.customerName.trim().slice(0, 80) : null,
          phone: input.customerPhone ? input.customerPhone.trim().slice(0, 20) : null,
        },
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }
      return { events: [evt], baseBill }
    },
  })
  return { bill: res.bill, event: res.events[0]! }
}

export async function setBillTable(
  db: SolvaDb,
  input: { billId: string; tableId: string; staffId: string },
  deps: BillMutationDeps = {},
): Promise<{ bill: BillRecord; event: BillEventEnvelopeV1 }> {
  const res = await appendLocalEventsTx(db, deps, {
    billId: input.billId,
    staffId: input.staffId,
    buildEvents: async ({ tx, baseBill, nextBillSeq, nextDeviceSeq, env }) => {
      const table = await tx.table<FnbTableRecord, string>('fnb_table').get(input.tableId)
      if (!table || table.deleted_at || !table.is_active) {
        throw new BillRepoError('TABLE_NOT_FOUND', 'Target table not found')
      }
      const billSeq = await nextBillSeq()
      const deviceSeq = await nextDeviceSeq()
      const evt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: input.billId,
        bill_seq: billSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        event_type: 'TABLE_SET',
        payload: { table_id: table.id },
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }
      return { events: [evt], baseBill }
    },
  })
  return { bill: res.bill, event: res.events[0]! }
}

export async function setBillDiscount(
  db: SolvaDb,
  input: {
    billId: string
    itemId?: string | null
    discount: { type: 'PERCENT'; pct: string } | { type: 'NOMINAL'; input: number } | null
    staffId: string
    approval?: { approverId: string; reason: string }
  },
  deps: BillMutationDeps = {},
): Promise<{ bill: BillRecord; event: BillEventEnvelopeV1 }> {
  const res = await appendLocalEventsTx(db, deps, {
    billId: input.billId,
    staffId: input.staffId,
    auditApproval: input.approval
      ? {
          action: 'discount.approve',
          approverId: input.approval.approverId,
          reasonText: input.approval.reason,
          afterData: input.discount ? { ...input.discount, item_id: input.itemId ?? null } : null,
        }
      : undefined,
    buildEvents: async ({ prevState, baseBill, nextBillSeq, nextDeviceSeq, env }) => {
      if (input.itemId) {
        const target = prevState.items.get(input.itemId)
        if (!target || target.status !== 'ACTIVE') {
          throw new BillRepoError('ITEM_NOT_FOUND', 'Active bill item not found')
        }
      }
      const billSeq = await nextBillSeq()
      const deviceSeq = await nextDeviceSeq()
      const evt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: input.billId,
        bill_seq: billSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        event_type: 'DISCOUNT_SET',
        payload: {
          item_id: input.itemId ?? null,
          type: input.discount ? input.discount.type : null,
          pct: input.discount?.type === 'PERCENT' ? input.discount.pct : null,
          input: input.discount?.type === 'NOMINAL' ? input.discount.input : null,
          approved_by: input.discount ? (input.approval?.approverId ?? null) : null,
        },
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }
      return { events: [evt], baseBill }
    },
  })
  return { bill: res.bill, event: res.events[0]! }
}

export async function printPrebill(
  db: SolvaDb,
  input: { billId: string; staffId: string; receiptLocale?: 'id-ID' | 'en-US' },
  deps: BillMutationDeps = {},
): Promise<{ bill: BillRecord; event: BillEventEnvelopeV1 }> {
  const receiptSetting = await db.outlet_receipt_setting.toCollection().first()
  const locale: 'id-ID' | 'en-US' =
    input.receiptLocale ?? (receiptSetting?.receipt_locale === 'en-US' ? 'en-US' : 'id-ID')

  // First commit PREBILL_PRINTED event + projection atomically (failure to print later never rolls back the event).
  const res = await appendLocalEventsTx(db, deps, {
    billId: input.billId,
    staffId: input.staffId,
    buildEvents: async ({ baseBill, nextBillSeq, nextDeviceSeq, env }) => {
      const billSeq = await nextBillSeq()
      const deviceSeq = await nextDeviceSeq()
      const evt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: input.billId,
        bill_seq: billSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        event_type: 'PREBILL_PRINTED',
        payload: {},
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }
      return { events: [evt], baseBill }
    },
  })

  // Best-effort print_job queue after event durability is committed (plan §C).
  try {
    const newId = deps.newId ?? (() => defaultIdGen.newId())
    const nowIso = res.events[0]!.occurred_at
    await db.transaction('rw', db.print_job, async (tx) => {
      await enqueuePrintJob(tx, {
        id: newId(),
        kind: 'PREBILL',
        status: 'QUEUED',
        entity_id: input.billId,
        entity_type: 'BILL',
        receipt_locale: locale,
        attempts: 0,
        last_error: null,
        created_at: nowIso,
        updated_at: nowIso,
      })
    })
  } catch {
    // Printing failure must not abort PREBILL_PRINTED state transition.
  }

  return { bill: res.bill, event: res.events[0]! }
}

export async function cancelBill(
  db: SolvaDb,
  input: { billId: string; staffId: string },
  deps: BillMutationDeps = {},
): Promise<{ bill: BillRecord; event: BillEventEnvelopeV1 }> {
  const res = await appendLocalEventsTx(db, deps, {
    billId: input.billId,
    staffId: input.staffId,
    buildEvents: async ({ prevState, baseBill, nextBillSeq, nextDeviceSeq, env }) => {
      for (const it of prevState.items.values()) {
        if (it.status === 'ACTIVE') {
          throw new BillRepoError(
            'BILL_HAS_ACTIVE_ITEMS',
            'Cannot cancel bill with active items (BR-FNB-008)',
          )
        }
      }
      const billSeq = await nextBillSeq()
      const deviceSeq = await nextDeviceSeq()
      const evt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: input.billId,
        bill_seq: billSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: deviceSeq,
        staff_id: input.staffId,
        event_type: 'BILL_CANCELED',
        payload: {},
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }
      return { events: [evt], baseBill }
    },
  })
  if (res.bill.parent_bill_id) {
    await db.transaction('rw', db.bill, async (tx) => {
      const bt: Table<BillRecord, string> = tx.table('bill')
      const siblings = await bt.where('parent_bill_id').equals(res.bill.parent_bill_id!).toArray()
      if (!siblings.some((s) => s.status === 'OPEN')) {
        const parent = await bt.get(res.bill.parent_bill_id!)
        if (parent && parent.status === 'SPLIT') {
          await bt.update(parent.id, { status: 'CLOSED_BY_SPLIT', closed_at: res.bill.closed_at })
        }
      }
    })
  }
  return { bill: res.bill, event: res.events[0]! }
}

export async function markLocalBillHandoverPending(
  db: SolvaDb,
  input: { billId: string; targetRegisterId: string; handoverEventId: string; lastEventSeq: number; nowIso: string },
): Promise<void> {
  await db.bill.update(input.billId, {
    handover_status: 'PENDING',
    handover_target_register_id: input.targetRegisterId,
    handover_event_id: input.handoverEventId,
    handover_requested_at: input.nowIso,
    last_event_seq: input.lastEventSeq,
    last_event_at: input.nowIso,
  })
}

export async function markLocalBillHandoverCanceled(
  db: SolvaDb,
  input: { billId: string; lastEventSeq: number; nowIso: string },
): Promise<void> {
  await db.bill.update(input.billId, {
    handover_status: 'NONE',
    handover_target_register_id: null,
    handover_event_id: null,
    handover_requested_at: null,
    last_event_seq: input.lastEventSeq,
    last_event_at: input.nowIso,
  })
}

export async function nextStandaloneDeviceSeq(
  db: SolvaDb,
  registerId: string,
  updatedAt: string,
): Promise<number> {
  return db.transaction('rw', db.local_counter, (tx) =>
    nextSeq(tx, DEVICE_SEQ_KEY, { registerId, updatedAt }),
  )
}

export async function listChildBillsByParent(
  db: SolvaDb,
  parentBillId: string,
): Promise<BillRecord[]> {
  const rows = await db.bill.where('parent_bill_id').equals(parentBillId).toArray()
  return rows.sort((a, b) => (a.share_index ?? 0) - (b.share_index ?? 0) || a.bill_ref.localeCompare(b.bill_ref))
}

export function observeChildBillsByParent(
  db: SolvaDb,
  parentBillId: string,
): Observable<BillRecord[]> {
  return liveQuery(() => listChildBillsByParent(db, parentBillId))
}

export interface LocalSplitChildRequest {
  readonly childBillRef?: string
  readonly tableId?: string
  readonly shareIndex?: number | null
  readonly shareCount?: number | null
  readonly customerName?: string | null
  readonly customerPhone?: string | null
  readonly items: readonly {
    readonly sourceBillItemId: string
    readonly lineNo: number
    readonly qty: string
  }[]
}

/**
 * Atomically splits an open local bill into 2..12 child bills in IndexedDB + queues `AppendBillEvents` (BILL_SPLIT).
 */
export async function splitBillLocal(
  db: SolvaDb,
  input: {
    parentBillId: string
    splitMode: 'ITEM' | 'QTY' | 'EQUAL'
    children: readonly LocalSplitChildRequest[]
    staffId: string
  },
  deps: BillMutationDeps = {},
): Promise<{ parent: BillRecord; children: BillRecord[]; event: BillEventEnvelopeV1 }> {
  if (input.children.length < 2) {
    throw new BillRepoError('CANNOT_EDIT', 'Split requires at least 2 child bills')
  }
  const env = await readEnvForBillAction(db, deps)

  return db.transaction(
    'rw',
    [db.bill, db.bill_item, db.bill_item_modifier, db.bill_event, db.outbox_command, db.local_counter],
    async (tx) => {
      const billTable: Table<BillRecord, string> = tx.table('bill')
      const itemTable: Table<BillItemRecord, string> = tx.table('bill_item')
      const modTable: Table<BillItemModifierRecord, string> = tx.table('bill_item_modifier')
      const eventTable: Table<BillEventRecord, string> = tx.table('bill_event')
      const counterTable: Table<LocalCounterRow, string> = tx.table('local_counter')

      const parent = await billTable.get(input.parentBillId)
      if (!parent) throw new BillRepoError('BILL_NOT_FOUND', 'Parent bill not found')
      const edit = canEditBill(parent, env.device.device_id)
      if (!edit.ok) throw new BillRepoError('CANNOT_EDIT', `Cannot split bill: ${edit.reason}`)
      if (parent.split_mode === 'EQUAL') {
        throw new BillRepoError('CANNOT_EDIT', 'Cannot split an equal-share bill again')
      }

      const parentItems = await itemTable.where('bill_id').equals(parent.id).toArray()
      const activeItems = new Map(parentItems.filter((it) => it.status === 'ACTIVE').map((it) => [it.id, it]))
      if (activeItems.size === 0) {
        throw new BillRepoError('CANNOT_EDIT', 'Cannot split a bill with no active items')
      }

      const parentItemIds = parentItems.map((it) => it.id)
      const parentMods = parentItemIds.length > 0 ? await modTable.where('bill_item_id').anyOf(parentItemIds).toArray() : []
      const modsByParentItem = new Map<string, BillItemModifierRecord[]>()
      for (const m of parentMods) {
        const arr = modsByParentItem.get(m.bill_item_id) ?? []
        arr.push(m)
        modsByParentItem.set(m.bill_item_id, arr)
      }

      // Compute nominal item discount split & nominal bill discount split matching server executeBillSplit.
      const specsBySource = new Map<string, { itemId: string; qty: string }[]>()
      const builtSpecs: BillSplitChildSpec[] = []
      const childInitMeta: {
        childId: string
        childEventId: string
        childDeviceSeq: number
        childRef: string
        tableId: string
      }[] = []

      for (let idx = 0; idx < input.children.length; idx += 1) {
        const c = input.children[idx]!
        const childId = env.newId()
        const childEventId = env.newId()
        const childDeviceSeq = await nextSeq(tx, DEVICE_SEQ_KEY, {
          registerId: env.device.register_id,
          updatedAt: env.createdAtDevice,
        })
        const childRef = c.childBillRef ?? `${parent.bill_ref.slice(0, 24)}-${idx + 1}`
        const childTableId = c.tableId ?? parent.table_id
        childInitMeta.push({ childId, childEventId, childDeviceSeq, childRef, tableId: childTableId })

        const mappedItems = c.items.map((it) => {
          const itemId = env.newId()
          const list = specsBySource.get(it.sourceBillItemId) ?? []
          list.push({ itemId, qty: it.qty })
          specsBySource.set(it.sourceBillItemId, list)
          return {
            item_id: itemId,
            source_bill_item_id: it.sourceBillItemId,
            line_no: it.lineNo,
            qty: it.qty,
          }
        })

        builtSpecs.push({
          child_bill_id: childId,
          child_event_id: childEventId,
          child_device_seq: childDeviceSeq,
          child_bill_ref: childRef,
          ...(c.tableId ? { table_id: c.tableId } : {}),
          share_index: input.splitMode === 'EQUAL' ? idx + 1 : null,
          share_count: input.splitMode === 'EQUAL' ? input.children.length : null,
          customer_name: c.customerName !== undefined ? c.customerName : parent.customer_name,
          customer_phone: c.customerPhone !== undefined ? c.customerPhone : parent.customer_phone,
          items: mappedItems,
        })
      }

      const specLineDisc = new Map<string, number | null>()
      if (input.splitMode !== 'EQUAL') {
        for (const [srcId, src] of activeItems.entries()) {
          const specs = specsBySource.get(srcId) ?? []
          if (src.discount_type === 'NOMINAL' && src.discount_input !== null) {
            if (specs.length === 1) {
              specLineDisc.set(specs[0]!.itemId, src.discount_input)
            } else {
              const weights = specs.map((sp) => Math.max(1, calcLineGross(toMoney(src.unit_price), parseQty(sp.qty))))
              const allocs = allocateLR(toMoney(src.discount_input), weights)
              specs.forEach((sp, i) => specLineDisc.set(sp.itemId, allocs[i]!))
            }
          } else {
            specs.forEach((sp) => specLineDisc.set(sp.itemId, null))
          }
        }
      }

      let childBillDiscounts: readonly (number | null)[] = builtSpecs.map(() => parent.bill_discount_input)
      if (
        input.splitMode !== 'EQUAL' &&
        parent.bill_discount_type === 'NOMINAL' &&
        parent.bill_discount_input !== null
      ) {
        const nets = builtSpecs.map((c) => {
          let sum = 0
          for (const sp of c.items) {
            const src = activeItems.get(sp.source_bill_item_id)!
            const gross = calcLineGross(toMoney(src.unit_price), parseQty(sp.qty))
            const lineDiscAmt =
              src.discount_type === 'PERCENT' && src.discount_pct
                ? calcLineDiscount(gross, { kind: 'PERCENT', percent: src.discount_pct })
                : src.discount_type === 'NOMINAL'
                  ? calcLineDiscount(gross, { kind: 'NOMINAL', amount: toMoney(specLineDisc.get(sp.item_id) ?? 0) })
                  : ZERO
            sum += gross - lineDiscAmt
          }
          return sum
        })
        const totalNet = nets.reduce((a, b) => a + b, 0)
        const capped = toMoney(Math.min(parent.bill_discount_input, totalNet))
        childBillDiscounts = totalNet > 0 && capped > 0 ? allocateLR(capped, nets) : builtSpecs.map(() => 0)
      }

      const parentSeq = await nextSeq(tx, billSeqCounterKey(parent.id), {
        registerId: env.device.register_id,
        docType: 'BILL_SEQ',
        updatedAt: env.createdAtDevice,
      })
      const parentDevSeq = await nextSeq(tx, DEVICE_SEQ_KEY, {
        registerId: env.device.register_id,
        updatedAt: env.createdAtDevice,
      })
      const splitEvt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: parent.id,
        bill_seq: parentSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: parentDevSeq,
        staff_id: input.staffId,
        event_type: 'BILL_SPLIT',
        payload: {
          split_mode: input.splitMode,
          children: builtSpecs,
        },
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }

      await eventTable.add({
        id: splitEvt.id,
        bill_id: splitEvt.bill_id,
        bill_seq: splitEvt.bill_seq,
        device_id: splitEvt.device_id,
        register_id: splitEvt.register_id,
        device_seq: splitEvt.device_seq,
        staff_id: splitEvt.staff_id,
        event_type: splitEvt.event_type,
        payload: splitEvt.payload,
        reason_code: null,
        reason_text: null,
        created_at_device: splitEvt.created_at_device,
        clock_offset_ms: splitEvt.clock_offset_ms,
        occurred_at: splitEvt.occurred_at,
        business_date: splitEvt.business_date,
        schema_version: splitEvt.schema_version,
        app_version: splitEvt.app_version ?? null,
      })

      const updatedParent: BillRecord = {
        ...parent,
        status: 'SPLIT',
        handover_status: 'NONE',
        handover_target_register_id: null,
        handover_event_id: null,
        handover_requested_at: null,
        split_mode: input.splitMode === 'EQUAL' ? null : input.splitMode,
        last_event_seq: parentSeq,
        last_event_at: env.occurredAt,
        sync_status: 'PENDING',
      }
      await billTable.put(updatedParent)

      if (input.splitMode !== 'EQUAL') {
        for (const id of activeItems.keys()) {
          await itemTable.update(id, { status: 'MOVED' })
        }
      }

      const createdChildren: BillRecord[] = []
      for (let i = 0; i < builtSpecs.length; i += 1) {
        const spec = builtSpecs[i]!
        const meta = childInitMeta[i]!

        await counterTable.put({
          key: billSeqCounterKey(meta.childId),
          register_id: env.device.register_id,
          doc_type: 'BILL_SEQ',
          period: null,
          last_seq: 1,
          updated_at: env.createdAtDevice,
        })

        const childRecord: BillRecord = {
          id: meta.childId,
          tenant_id: parent.tenant_id,
          outlet_id: parent.outlet_id,
          register_id: env.device.register_id,
          device_id: env.device.device_id,
          table_id: meta.tableId,
          bill_ref: meta.childRef,
          status: 'OPEN',
          lease_device_id: env.device.device_id,
          lease_register_id: env.device.register_id,
          handover_status: 'NONE',
          handover_target_register_id: null,
          handover_event_id: null,
          handover_requested_at: null,
          prebill_seq: null,
          prebill_printed_at: null,
          last_content_seq: 1,
          is_awaiting_payment: false,
          split_mode: input.splitMode,
          parent_bill_id: parent.id,
          share_index: input.splitMode === 'EQUAL' ? i + 1 : null,
          share_count: input.splitMode === 'EQUAL' ? builtSpecs.length : null,
          bill_discount_type: parent.bill_discount_type,
          bill_discount_pct: parent.bill_discount_pct,
          bill_discount_input:
            parent.bill_discount_type === 'NOMINAL' ? (childBillDiscounts[i] ?? 0) : null,
          bill_discount_approved_by: parent.bill_discount_approved_by,
          customer_name: spec.customer_name ?? null,
          customer_phone: spec.customer_phone ?? null,
          last_event_seq: 1,
          last_event_at: env.occurredAt,
          created_by: input.staffId,
          created_at_device: env.createdAtDevice,
          occurred_at: env.occurredAt,
          business_date: env.businessDate,
          closed_at: null,
          sync_status: 'PENDING',
        }
        await billTable.put(childRecord)
        createdChildren.push(childRecord)

        await eventTable.add({
          id: meta.childEventId,
          bill_id: meta.childId,
          bill_seq: 1,
          device_id: env.device.device_id,
          register_id: env.device.register_id,
          device_seq: meta.childDeviceSeq,
          staff_id: input.staffId,
          event_type: 'BILL_OPENED',
          payload: { table_id: meta.tableId, bill_ref: meta.childRef },
          reason_code: null,
          reason_text: null,
          created_at_device: env.createdAtDevice,
          clock_offset_ms: env.offsetMs,
          occurred_at: env.occurredAt,
          business_date: env.businessDate,
          schema_version: SCHEMA_VERSION,
          app_version: env.appVersion,
        })

        for (const sp of spec.items) {
          const src = activeItems.get(sp.source_bill_item_id)!
          const newItem: BillItemRecord = {
            id: sp.item_id,
            bill_id: meta.childId,
            line_no: sp.line_no,
            product_id: src.product_id ?? null,
            sku_id: src.sku_id,
            uom_id: src.uom_id,
            sku_code: src.sku_code,
            item_name: src.item_name,
            uom_code: src.uom_code,
            qty: sp.qty,
            conversion_factor: src.conversion_factor,
            unit_price: src.unit_price,
            price_source: src.price_source,
            is_open_price: src.is_open_price,
            taxable: src.taxable,
            discount_type: src.discount_type,
            discount_pct: src.discount_pct,
            discount_input: src.discount_type === 'NOMINAL' ? (specLineDisc.get(sp.item_id) ?? 0) : null,
            discount_approved_by: src.discount_approved_by,
            note: src.note,
            status: 'ACTIVE',
            void_reason_code: null,
            void_reason_text: null,
            created_event_id: meta.childEventId,
          }
          await itemTable.put(newItem)

          const mods = modsByParentItem.get(src.id) ?? []
          if (mods.length > 0) {
            await modTable.bulkPut(
              mods.map((m) => ({
                id: `${sp.item_id}:${m.modifier_id}`,
                bill_item_id: sp.item_id,
                modifier_id: m.modifier_id,
                name: m.name,
                price_delta: m.price_delta,
                qty: m.qty,
              })),
            )
          }
        }
      }

      const cmdId = env.newId()
      const payload: AppendBillEventsPayloadV1 = {
        bill_id: parent.id,
        events: [splitEvt],
      }
      await enqueueCommand(tx, {
        id: cmdId,
        type: 'AppendBillEvents',
        payload,
        schemaVersion: SCHEMA_VERSION,
        registerId: env.device.register_id,
        dependencyKey: `bill:${parent.id}`,
        createdAtDevice: env.createdAtDevice,
      })

      return { parent: updatedParent, children: createdChildren, event: splitEvt }
    },
  ).then((res) => {
    kickActiveSync()
    return res
  })
}

/**
 * Atomically merges one or more open bills held by this device into `targetBillId`,
 * consolidating identical items via `mergeSimilarItems` and enqueuing `BILL_MERGED`.
 */
export async function mergeBillsLocal(
  db: SolvaDb,
  input: {
    targetBillId: string
    sourceBillIds: readonly string[]
    staffId: string
  },
  deps: BillMutationDeps = {},
): Promise<{ target: BillRecord; event: BillEventEnvelopeV1 }> {
  const uniqueSources = [...new Set(input.sourceBillIds)].filter((id) => id !== input.targetBillId)
  if (uniqueSources.length === 0) {
    throw new BillRepoError('CANNOT_EDIT', 'Merge requires at least one source bill')
  }
  const env = await readEnvForBillAction(db, deps)

  return db.transaction(
    'rw',
    [db.bill, db.bill_item, db.bill_item_modifier, db.bill_event, db.outbox_command, db.local_counter],
    async (tx) => {
      const billTable: Table<BillRecord, string> = tx.table('bill')
      const itemTable: Table<BillItemRecord, string> = tx.table('bill_item')
      const modTable: Table<BillItemModifierRecord, string> = tx.table('bill_item_modifier')
      const eventTable: Table<BillEventRecord, string> = tx.table('bill_event')

      const target = await billTable.get(input.targetBillId)
      if (!target) throw new BillRepoError('BILL_NOT_FOUND', 'Target bill not found')
      const editTarget = canEditBill(target, env.device.device_id)
      if (!editTarget.ok || target.parent_bill_id !== null) {
        throw new BillRepoError('CANNOT_EDIT', 'Target bill cannot be merged')
      }

      const targetItems = await itemTable.where('bill_id').equals(target.id).toArray()
      const targetMods =
        targetItems.length > 0
          ? await modTable.where('bill_item_id').anyOf(targetItems.map((i) => i.id)).toArray()
          : []
      const modsByItem = new Map<string, BillItemModifierRecord[]>()
      for (const m of targetMods) {
        const arr = modsByItem.get(m.bill_item_id) ?? []
        arr.push(m)
        modsByItem.set(m.bill_item_id, arr)
      }

      const toProjItem = (
        it: BillItemRecord,
        mods: readonly BillItemModifierRecord[],
      ): BillProjectionItem => ({
        id: it.id,
        lineNo: it.line_no,
        skuId: it.sku_id,
        uomId: it.uom_id,
        skuCode: it.sku_code,
        itemName: it.item_name,
        uomCode: it.uom_code,
        qty: it.qty,
        conversionFactor: it.conversion_factor,
        unitPrice: it.unit_price,
        priceSource: it.price_source,
        isOpenPrice: it.is_open_price,
        taxable: it.taxable,
        discountType: it.discount_type,
        discountPct: it.discount_pct,
        discountInput: it.discount_input,
        discountApprovedBy: it.discount_approved_by,
        note: it.note,
        status: it.status,
        voidReasonCode: it.void_reason_code ?? null,
        voidReasonText: it.void_reason_text ?? null,
        createdEventId: it.created_event_id,
        modifiers: mods.map((m) => ({
          modifierId: m.modifier_id,
          name: m.name,
          priceDelta: m.price_delta,
          qty: m.qty,
        })),
      })

      const incoming: {
        originBillId: string
        originItemId: string
        newItemId: string
        item: BillProjectionItem
        productId: string | null
      }[] = []
      const movedItemTargets: Record<string, string> = {}
      const sourceEventIds: Record<string, string> = {}
      const sourceDeviceSeqs: Record<string, number> = {}
      const dependsOnIds: string[] = []
      const sourcesToClose: { bill: BillRecord; activeIds: string[]; seq: number }[] = []

      for (const srcId of uniqueSources) {
        const src = await billTable.get(srcId)
        if (!src) throw new BillRepoError('BILL_NOT_FOUND', `Source bill ${srcId} not found`)
        const editSrc = canEditBill(src, env.device.device_id)
        if (!editSrc.ok || src.parent_bill_id !== null) {
          throw new BillRepoError('CANNOT_EDIT', `Source bill ${src.bill_ref} cannot be merged`)
        }

        const srcItems = await itemTable.where('bill_id').equals(srcId).toArray()
        const srcMods =
          srcItems.length > 0
            ? await modTable.where('bill_item_id').anyOf(srcItems.map((i) => i.id)).toArray()
            : []
        const srcModMap = new Map<string, BillItemModifierRecord[]>()
        for (const m of srcMods) {
          const arr = srcModMap.get(m.bill_item_id) ?? []
          arr.push(m)
          srcModMap.set(m.bill_item_id, arr)
        }

        const activeIds: string[] = []
        for (const it of srcItems) {
          if (it.status !== 'ACTIVE') continue
          activeIds.push(it.id)
          const newId = env.newId()
          movedItemTargets[it.id] = newId
          incoming.push({
            originBillId: srcId,
            originItemId: it.id,
            newItemId: newId,
            productId: it.product_id ?? null,
            item: toProjItem(it, srcModMap.get(it.id) ?? []),
          })
        }

        sourceEventIds[srcId] = env.newId()
        sourceDeviceSeqs[srcId] = await nextSeq(tx, DEVICE_SEQ_KEY, {
          registerId: env.device.register_id,
          updatedAt: env.createdAtDevice,
        })
        const nextSrcSeq = await nextSeq(tx, billSeqCounterKey(srcId), {
          registerId: env.device.register_id,
          docType: 'BILL_SEQ',
          updatedAt: env.createdAtDevice,
        })
        sourcesToClose.push({ bill: src, activeIds, seq: nextSrcSeq })

        const srcPending = await tx
          .table<OutboxCommandRow, string>('outbox_command')
          .where('dependency_key')
          .equals(`bill:${srcId}`)
          .toArray()
        const latestSrc = srcPending
          .filter((c) => c.status !== 'ACKED' && c.status !== 'DISMISSED')
          .sort((a, b) => b.device_seq - a.device_seq)[0]
        if (latestSrc) dependsOnIds.push(latestSrc.id)
      }

      const targetSeq = await nextSeq(tx, billSeqCounterKey(target.id), {
        registerId: env.device.register_id,
        docType: 'BILL_SEQ',
        updatedAt: env.createdAtDevice,
      })
      const targetDevSeq = await nextSeq(tx, DEVICE_SEQ_KEY, {
        registerId: env.device.register_id,
        updatedAt: env.createdAtDevice,
      })
      const mergeEvt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: target.id,
        bill_seq: targetSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: targetDevSeq,
        staff_id: input.staffId,
        event_type: 'BILL_MERGED',
        payload: {
          source_bill_ids: uniqueSources,
          source_event_ids: sourceEventIds,
          source_device_seqs: sourceDeviceSeqs,
          moved_item_targets: movedItemTargets,
        },
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }

      await eventTable.add({
        id: mergeEvt.id,
        bill_id: mergeEvt.bill_id,
        bill_seq: mergeEvt.bill_seq,
        device_id: mergeEvt.device_id,
        register_id: mergeEvt.register_id,
        device_seq: mergeEvt.device_seq,
        staff_id: mergeEvt.staff_id,
        event_type: mergeEvt.event_type,
        payload: mergeEvt.payload,
        reason_code: null,
        reason_text: null,
        created_at_device: mergeEvt.created_at_device,
        clock_offset_ms: mergeEvt.clock_offset_ms,
        occurred_at: mergeEvt.occurred_at,
        business_date: mergeEvt.business_date,
        schema_version: mergeEvt.schema_version,
        app_version: mergeEvt.app_version ?? null,
      })

      const targetProjItems = targetItems.map((it) => toProjItem(it, modsByItem.get(it.id) ?? []))
      const merged = mergeSimilarItems(targetProjItems, incoming)
      const incomingByNewId = new Map(incoming.map((inc) => [inc.newItemId, inc] as const))

      for (const upd of merged.updatedExisting) {
        await itemTable.update(upd.id, { qty: upd.nextQty })
      }
      for (const added of merged.insertedNew) {
        const incMeta = incomingByNewId.get(added.id)
        await itemTable.put({
          id: added.id,
          bill_id: target.id,
          line_no: added.lineNo,
          product_id: incMeta?.productId ?? null,
          sku_id: added.skuId,
          uom_id: added.uomId,
          sku_code: added.skuCode,
          item_name: added.itemName,
          uom_code: added.uomCode,
          qty: added.qty,
          conversion_factor: added.conversionFactor,
          unit_price: added.unitPrice,
          price_source: added.priceSource,
          is_open_price: added.isOpenPrice,
          taxable: added.taxable,
          discount_type: added.discountType,
          discount_pct: added.discountPct,
          discount_input: added.discountInput,
          discount_approved_by: added.discountApprovedBy,
          note: added.note,
          status: 'ACTIVE',
          void_reason_code: null,
          void_reason_text: null,
          created_event_id: mergeEvt.id,
        })
        if (added.modifiers.length > 0) {
          await modTable.bulkPut(
            added.modifiers.map((m) => ({
              id: `${added.id}:${m.modifierId}`,
              bill_item_id: added.id,
              modifier_id: m.modifierId,
              name: m.name,
              price_delta: m.priceDelta,
              qty: m.qty,
            })),
          )
        }
      }

      for (const sc of sourcesToClose) {
        for (const itemId of sc.activeIds) {
          await itemTable.update(itemId, { status: 'MOVED' })
        }
        await billTable.update(sc.bill.id, {
          status: 'MERGED',
          handover_status: 'NONE',
          handover_target_register_id: null,
          handover_event_id: null,
          handover_requested_at: null,
          last_event_seq: sc.seq,
          last_event_at: env.occurredAt,
          closed_at: env.occurredAt,
          sync_status: 'PENDING',
        })
      }

      const updatedTarget: BillRecord = {
        ...target,
        last_content_seq: targetSeq,
        last_event_seq: targetSeq,
        last_event_at: env.occurredAt,
        sync_status: 'PENDING',
      }
      await billTable.put(updatedTarget)

      const cmdId = env.newId()
      const payload: AppendBillEventsPayloadV1 = {
        bill_id: target.id,
        events: [mergeEvt],
      }
      await enqueueCommand(tx, {
        id: cmdId,
        type: 'AppendBillEvents',
        payload,
        schemaVersion: SCHEMA_VERSION,
        registerId: env.device.register_id,
        dependencyKey: `bill:${target.id}`,
        ...(dependsOnIds.length > 0 ? { dependsOn: dependsOnIds } : {}),
        createdAtDevice: env.createdAtDevice,
      })

      return { target: updatedTarget, event: mergeEvt }
    },
  ).then((res) => {
    kickActiveSync()
    return res
  })
}
