import { addQty, parseQty } from '~/lib/kernel'
import type {
  BillHandoverStatus,
  BillItemStatus,
  BillSplitMode,
  BillStatus,
  DiscountType,
  PriceSource,
} from '~/lib/contracts'
import {
  BillEventEnvelopeV1Schema,
  BillOpenedPayloadSchema,
  CustomerSetPayloadSchema,
  DiscountSetPayloadSchema,
  ItemAddedPayloadSchema,
  ItemQtyChangedPayloadSchema,
  ItemVoidedPayloadSchema,
  ModifierSetPayloadSchema,
  TableSetPayloadSchema,
  type BillEventEnvelopeV1,
  type BillItemModifierInput,
} from './bill-events'

export type BillProjectionErrorCode =
  | 'BILL_CLOSED'
  | 'BILL_NOT_OPENED'
  | 'BILL_ALREADY_OPENED'
  | 'BILL_HAS_ACTIVE_ITEMS'
  | 'BILL_SEQ_GAP'
  | 'BILL_SEQ_CONFLICT'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_NOT_ACTIVE'
  | 'VOID_REASON_REQUIRED'

export class BillProjectionError extends Error {
  constructor(
    public readonly code: BillProjectionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BillProjectionError'
  }
}

export interface BillProjectionItemModifier {
  readonly modifierId: string
  readonly name: string
  readonly priceDelta: number
  readonly qty: number
}

export interface BillProjectionItem {
  readonly id: string
  readonly lineNo: number
  readonly skuId: string
  readonly uomId: string
  readonly skuCode: string
  readonly itemName: string
  readonly uomCode: string
  readonly qty: string
  readonly conversionFactor: string
  readonly unitPrice: number
  readonly priceSource: PriceSource
  readonly isOpenPrice: boolean
  readonly taxable: boolean
  readonly discountType: DiscountType | null
  readonly discountPct: string | null
  readonly discountInput: number | null
  readonly discountApprovedBy: string | null
  readonly note: string | null
  readonly status: BillItemStatus
  readonly voidReasonCode: string | null
  readonly voidReasonText: string | null
  readonly createdEventId: string
  readonly modifiers: readonly BillProjectionItemModifier[]
}

export interface BillProjectionState {
  readonly billId: string
  readonly status: 'UNOPENED' | BillStatus
  readonly tableId: string | null
  readonly billRef: string | null
  readonly leaseDeviceId: string | null
  readonly leaseRegisterId: string | null
  readonly handoverStatus: BillHandoverStatus
  readonly handoverTargetRegisterId: string | null
  readonly handoverEventId: string | null
  readonly handoverRequestedAt: string | null
  readonly prebillSeq: number | null
  readonly prebillPrintedAt: string | null
  readonly lastContentSeq: number
  readonly splitMode: BillSplitMode | null
  readonly billDiscountType: DiscountType | null
  readonly billDiscountPct: string | null
  readonly billDiscountInput: number | null
  readonly billDiscountApprovedBy: string | null
  readonly customerName: string | null
  readonly customerPhone: string | null
  readonly lastEventSeq: number
  readonly lastEventAt: string | null
  readonly closedAt: string | null
  readonly items: ReadonlyMap<string, BillProjectionItem>
  readonly appliedEventIds: ReadonlySet<string>
}

export function emptyBill(billId: string): BillProjectionState {
  return {
    billId,
    status: 'UNOPENED',
    tableId: null,
    billRef: null,
    leaseDeviceId: null,
    leaseRegisterId: null,
    handoverStatus: 'NONE',
    handoverTargetRegisterId: null,
    handoverEventId: null,
    handoverRequestedAt: null,
    prebillSeq: null,
    prebillPrintedAt: null,
    lastContentSeq: 0,
    splitMode: null,
    billDiscountType: null,
    billDiscountPct: null,
    billDiscountInput: null,
    billDiscountApprovedBy: null,
    customerName: null,
    customerPhone: null,
    lastEventSeq: 0,
    lastEventAt: null,
    closedAt: null,
    items: new Map(),
    appliedEventIds: new Set(),
  }
}

export function isAwaitingPayment(state: BillProjectionState): boolean {
  return state.status === 'OPEN' && state.prebillSeq !== null && state.prebillSeq > state.lastContentSeq
}

function toProjectionModifiers(mods: readonly BillItemModifierInput[]): readonly BillProjectionItemModifier[] {
  return mods.map((m) => ({
    modifierId: m.modifier_id,
    name: m.name,
    priceDelta: m.price_delta,
    qty: m.qty ?? 1,
  }))
}

/**
 * Pure deterministic event reducer for F&B open bills (SCHEMA §4.5.12–4.5.14, BR-FNB-005/008/010/012).
 * Idempotent on `evt.id`; enforces sequential `bill_seq` and domain invariants without wall-clock reads.
 */
export function applyBillEvent(
  state: BillProjectionState,
  rawEvent: BillEventEnvelopeV1,
): BillProjectionState {
  const evt = BillEventEnvelopeV1Schema.parse(rawEvent)
  if (evt.bill_id !== state.billId) {
    throw new BillProjectionError('BILL_SEQ_CONFLICT', `Event bill_id ${evt.bill_id} does not match ${state.billId}`)
  }

  if (state.appliedEventIds.has(evt.id)) {
    return state
  }

  if (
    state.status === 'PAID' ||
    state.status === 'CANCELED' ||
    state.status === 'MERGED' ||
    state.status === 'CLOSED_BY_SPLIT'
  ) {
    throw new BillProjectionError('BILL_CLOSED', `Cannot apply ${evt.event_type} to ${state.status} bill`)
  }

  if (evt.bill_seq <= state.lastEventSeq) {
    throw new BillProjectionError(
      'BILL_SEQ_CONFLICT',
      `bill_seq ${evt.bill_seq} already passed (last_event_seq=${state.lastEventSeq})`,
    )
  }
  if (evt.bill_seq > state.lastEventSeq + 1) {
    throw new BillProjectionError(
      'BILL_SEQ_GAP',
      `bill_seq ${evt.bill_seq} leaves a gap after ${state.lastEventSeq}`,
    )
  }

  const nextApplied = new Set(state.appliedEventIds)
  nextApplied.add(evt.id)

  if (state.status === 'UNOPENED') {
    if (evt.event_type !== 'BILL_OPENED') {
      throw new BillProjectionError('BILL_NOT_OPENED', `First bill event must be BILL_OPENED, got ${evt.event_type}`)
    }
    const p = BillOpenedPayloadSchema.parse(evt.payload)
    return {
      ...state,
      status: 'OPEN',
      tableId: p.table_id,
      billRef: p.bill_ref,
      leaseDeviceId: evt.device_id,
      leaseRegisterId: evt.register_id,
      customerName: p.customer_name ?? null,
      customerPhone: p.customer_phone ?? null,
      lastEventSeq: evt.bill_seq,
      lastEventAt: evt.occurred_at,
      appliedEventIds: nextApplied,
    }
  }

  if (evt.event_type === 'BILL_OPENED') {
    throw new BillProjectionError('BILL_ALREADY_OPENED', 'Bill is already opened')
  }

  switch (evt.event_type) {
    case 'ITEM_ADDED': {
      const p = ItemAddedPayloadSchema.parse(evt.payload)
      const nextItems = new Map(state.items)
      nextItems.set(p.item_id, {
        id: p.item_id,
        lineNo: p.line_no,
        skuId: p.sku_id,
        uomId: p.uom_id,
        skuCode: p.sku_code,
        itemName: p.item_name,
        uomCode: p.uom_code,
        qty: p.qty,
        conversionFactor: p.conversion_factor,
        unitPrice: p.unit_price,
        priceSource: p.price_source,
        isOpenPrice: p.is_open_price,
        taxable: p.taxable,
        discountType: p.discount?.type ?? null,
        discountPct: p.discount?.pct ?? null,
        discountInput: p.discount?.input ?? null,
        discountApprovedBy: p.discount?.approved_by ?? null,
        note: p.note ?? null,
        status: 'ACTIVE',
        voidReasonCode: null,
        voidReasonText: null,
        createdEventId: evt.id,
        modifiers: toProjectionModifiers(p.modifiers),
      })
      return {
        ...state,
        items: nextItems,
        lastContentSeq: evt.bill_seq,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'ITEM_VOIDED': {
      const p = ItemVoidedPayloadSchema.parse(evt.payload)
      const existing = state.items.get(p.item_id)
      if (!existing) {
        throw new BillProjectionError('ITEM_NOT_FOUND', `Unknown bill item ${p.item_id}`)
      }
      if (existing.status !== 'ACTIVE') {
        throw new BillProjectionError('ITEM_NOT_ACTIVE', `Cannot void non-ACTIVE bill item ${p.item_id}`)
      }
      if (!evt.reason_text || evt.reason_text.trim().length === 0) {
        throw new BillProjectionError('VOID_REASON_REQUIRED', 'reason_text is required for ITEM_VOIDED')
      }
      const nextItems = new Map(state.items)
      nextItems.set(p.item_id, {
        ...existing,
        status: 'VOIDED',
        voidReasonCode: evt.reason_code ?? null,
        voidReasonText: evt.reason_text,
      })
      return {
        ...state,
        items: nextItems,
        lastContentSeq: evt.bill_seq,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'ITEM_QTY_CHANGED': {
      const p = ItemQtyChangedPayloadSchema.parse(evt.payload)
      const existing = state.items.get(p.item_id)
      if (!existing) {
        throw new BillProjectionError('ITEM_NOT_FOUND', `Unknown bill item ${p.item_id}`)
      }
      if (existing.status !== 'ACTIVE') {
        throw new BillProjectionError('ITEM_NOT_ACTIVE', `Cannot change qty of non-ACTIVE bill item ${p.item_id}`)
      }
      const nextItems = new Map(state.items)
      nextItems.set(p.item_id, {
        ...existing,
        qty: p.qty,
      })
      return {
        ...state,
        items: nextItems,
        lastContentSeq: evt.bill_seq,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'MODIFIER_SET': {
      const p = ModifierSetPayloadSchema.parse(evt.payload)
      const existing = state.items.get(p.item_id)
      if (!existing) {
        throw new BillProjectionError('ITEM_NOT_FOUND', `Unknown bill item ${p.item_id}`)
      }
      if (existing.status !== 'ACTIVE') {
        throw new BillProjectionError('ITEM_NOT_ACTIVE', `Cannot change modifiers on non-ACTIVE item ${p.item_id}`)
      }
      const nextItems = new Map(state.items)
      nextItems.set(p.item_id, {
        ...existing,
        unitPrice: p.unit_price,
        modifiers: toProjectionModifiers(p.modifiers),
      })
      return {
        ...state,
        items: nextItems,
        lastContentSeq: evt.bill_seq,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'CUSTOMER_SET': {
      const p = CustomerSetPayloadSchema.parse(evt.payload)
      return {
        ...state,
        customerName: p.name === undefined ? state.customerName : p.name,
        customerPhone: p.phone === undefined ? state.customerPhone : p.phone,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'TABLE_SET': {
      const p = TableSetPayloadSchema.parse(evt.payload)
      return {
        ...state,
        tableId: p.table_id,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'DISCOUNT_SET': {
      const p = DiscountSetPayloadSchema.parse(evt.payload)
      if (p.item_id) {
        const existing = state.items.get(p.item_id)
        if (!existing) {
          throw new BillProjectionError('ITEM_NOT_FOUND', `Unknown bill item ${p.item_id}`)
        }
        if (existing.status !== 'ACTIVE') {
          throw new BillProjectionError('ITEM_NOT_ACTIVE', `Cannot set discount on non-ACTIVE item ${p.item_id}`)
        }
        const nextItems = new Map(state.items)
        nextItems.set(p.item_id, {
          ...existing,
          discountType: p.type,
          discountPct: p.type === 'PERCENT' ? (p.pct ?? null) : null,
          discountInput: p.type === 'NOMINAL' ? (p.input ?? null) : null,
          discountApprovedBy: p.type ? (p.approved_by ?? null) : null,
        })
        return {
          ...state,
          items: nextItems,
          lastEventSeq: evt.bill_seq,
          lastEventAt: evt.occurred_at,
          appliedEventIds: nextApplied,
        }
      }

      return {
        ...state,
        billDiscountType: p.type,
        billDiscountPct: p.type === 'PERCENT' ? (p.pct ?? null) : null,
        billDiscountInput: p.type === 'NOMINAL' ? (p.input ?? null) : null,
        billDiscountApprovedBy: p.type ? (p.approved_by ?? null) : null,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'BILL_CANCELED': {
      for (const item of state.items.values()) {
        if (item.status === 'ACTIVE') {
          throw new BillProjectionError(
            'BILL_HAS_ACTIVE_ITEMS',
            'Cannot cancel a bill that still has active items (BR-FNB-008)',
          )
        }
      }
      return {
        ...state,
        status: 'CANCELED',
        handoverStatus: 'NONE',
        handoverTargetRegisterId: null,
        handoverEventId: null,
        handoverRequestedAt: null,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        closedAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'PREBILL_PRINTED': {
      return {
        ...state,
        prebillSeq: evt.bill_seq,
        prebillPrintedAt: evt.occurred_at,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'BILL_HANDED_OVER': {
      const targetRegisterId =
        evt.target_register_id ?? (evt.payload.target_register_id as string | undefined) ?? null
      return {
        ...state,
        handoverStatus: 'PENDING',
        handoverTargetRegisterId: targetRegisterId,
        handoverEventId: evt.id,
        handoverRequestedAt: evt.occurred_at,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'BILL_ACCEPTED': {
      return {
        ...state,
        leaseDeviceId: evt.device_id,
        leaseRegisterId: evt.register_id,
        handoverStatus: 'NONE',
        handoverTargetRegisterId: null,
        handoverEventId: null,
        handoverRequestedAt: null,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'BILL_HANDOVER_CANCELED': {
      return {
        ...state,
        handoverStatus: 'NONE',
        handoverTargetRegisterId: null,
        handoverEventId: null,
        handoverRequestedAt: null,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'BILL_SPLIT': {
      return {
        ...state,
        status: 'SPLIT',
        handoverStatus: 'NONE',
        handoverTargetRegisterId: null,
        handoverEventId: null,
        handoverRequestedAt: null,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }

    case 'BILL_MERGED': {
      return {
        ...state,
        lastEventSeq: evt.bill_seq,
        lastEventAt: evt.occurred_at,
        appliedEventIds: nextApplied,
      }
    }
  }
}

export function similarBillItemKey(item: {
  skuId: string
  uomId: string
  unitPrice: number
  priceSource: PriceSource
  isOpenPrice: boolean
  taxable: boolean
  discountType: DiscountType | null
  discountPct: string | null
  discountInput: number | null
  note: string | null
  modifiers: readonly BillProjectionItemModifier[]
}): string {
  const modsKey = [...item.modifiers]
    .sort((a, b) => a.modifierId.localeCompare(b.modifierId))
    .map((m) => `${m.modifierId}:${m.qty}:${m.priceDelta}`)
    .join('|')
  return [
    item.skuId,
    item.uomId,
    item.unitPrice,
    item.priceSource,
    item.isOpenPrice ? '1' : '0',
    item.taxable ? '1' : '0',
    item.discountType ?? '',
    item.discountPct ?? '',
    item.discountInput ?? '',
    item.note ?? '',
    modsKey,
  ].join('::')
}

export interface MergedTargetResult {
  readonly nextTargetItems: readonly BillProjectionItem[]
  readonly updatedExisting: readonly { readonly id: string; readonly nextQty: string }[]
  readonly insertedNew: readonly BillProjectionItem[]
}

/**
 * Pure line consolidation used by BILL_MERGED on both client and server:
 * identical SKU, UOM, unit price, discount, note, and canonical modifiers fold by adding `qty`.
 */
export function mergeSimilarItems(
  targetItems: readonly BillProjectionItem[],
  incomingItems: readonly {
    readonly originBillId: string
    readonly originItemId: string
    readonly newItemId: string
    readonly item: BillProjectionItem
  }[],
): MergedTargetResult {
  const byKey = new Map<string, BillProjectionItem>()
  const nextList: BillProjectionItem[] = []
  let maxLineNo = 0

  for (const existing of targetItems) {
    maxLineNo = Math.max(maxLineNo, existing.lineNo)
    nextList.push(existing)
    if (existing.status === 'ACTIVE') {
      byKey.set(similarBillItemKey(existing), existing)
    }
  }

  const updatedById = new Map<string, string>()
  const insertedNew: BillProjectionItem[] = []

  for (const inc of incomingItems) {
    if (inc.item.status !== 'ACTIVE') continue
    const key = similarBillItemKey(inc.item)
    const match = byKey.get(key)
    if (match) {
      const mergedQty = addQty(parseQty(match.qty), parseQty(inc.item.qty))
      const updatedMatch: BillProjectionItem = { ...match, qty: mergedQty }
      byKey.set(key, updatedMatch)
      updatedById.set(match.id, mergedQty)
      const idx = nextList.findIndex((x) => x.id === match.id)
      if (idx >= 0) nextList[idx] = updatedMatch
    } else {
      maxLineNo += 1
      const added: BillProjectionItem = {
        ...inc.item,
        id: inc.newItemId,
        lineNo: maxLineNo,
      }
      nextList.push(added)
      insertedNew.push(added)
      byKey.set(key, added)
    }
  }

  return {
    nextTargetItems: nextList,
    updatedExisting: [...updatedById.entries()].map(([id, nextQty]) => ({ id, nextQty })),
    insertedNew,
  }
}

/**
 * Deterministically folds an arbitrarily ordered list of events for `billId`.
 * Deduplicates by event `id` first, then sorts by `bill_seq ASC` before applying.
 */
export function foldBillEvents(
  billId: string,
  events: readonly BillEventEnvelopeV1[],
): BillProjectionState {
  const uniqueById = new Map<string, BillEventEnvelopeV1>()
  for (const evt of events) {
    if (!uniqueById.has(evt.id)) {
      uniqueById.set(evt.id, evt)
    }
  }
  const ordered = [...uniqueById.values()].sort((a, b) => a.bill_seq - b.bill_seq)
  let state = emptyBill(billId)
  for (const evt of ordered) {
    state = applyBillEvent(state, evt)
  }
  return state
}
