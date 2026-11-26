import type { Table } from 'dexie'
import {
  SCHEMA_VERSION,
  type AppendBillEventsPayloadV1,
  type BillSplitChildSpec,
} from '~/lib/contracts'
import { allocateLR, parseQty, toMoney, ZERO } from '~/lib/kernel'
import { calcLineDiscount, calcLineGross } from '~/lib/sales-calc'
import type { BillEventEnvelopeV1 } from '~/modules/fnb/shared'
import type { SolvaDb } from '../db/solva-db'
import type {
  BillEventRecord,
  BillItemModifierRecord,
  BillItemRecord,
  BillRecord,
  LocalCounterRow,
} from '../db/types'
import { canEditBill } from '../domain/bill-guards'
import { BillRepoError, readEnvForBillAction, type BillMutationDeps } from './bill.repo'
import { billSeqCounterKey, DEVICE_SEQ_KEY, nextSeq } from './counter.repo'
import { enqueueCommand } from './outbox.repo'
import { kickActiveSync } from '../sync'

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
