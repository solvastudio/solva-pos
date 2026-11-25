import { liveQuery, type Observable, type Table } from 'dexie'
import type { BillDetailResponse, BillsSnapshotBlock } from '~/lib/contracts'
import type { SolvaDb } from '../db/solva-db'
import type {
  BillItemModifierRecord,
  BillItemRecord,
  BillRecord,
  BillSnapshotRecord,
} from '../db/types'
import { billSeqCounterKey } from './counter.repo'
import { getMeta, setMeta } from './meta.repo'

export async function listBillSnapshots(db: SolvaDb): Promise<BillSnapshotRecord[]> {
  return db.bill_snapshot.toArray()
}

export async function getBillSnapshotById(
  db: SolvaDb,
  billId: string,
): Promise<BillSnapshotRecord | null> {
  return (await db.bill_snapshot.get(billId)) ?? null
}

export async function listIncomingBillSnapshots(
  db: SolvaDb,
  registerId: string,
): Promise<BillSnapshotRecord[]> {
  const rows = await db.bill_snapshot.where('handover_target_register_id').equals(registerId).toArray()
  return rows.filter((r) => r.status === 'OPEN' && r.handover_status === 'PENDING')
}

export function observeBillSnapshots(db: SolvaDb): Observable<BillSnapshotRecord[]> {
  return liveQuery(() => db.bill_snapshot.toArray())
}

export function observeIncomingBillSnapshots(
  db: SolvaDb,
  registerId: string,
): Observable<BillSnapshotRecord[]> {
  return liveQuery(() => listIncomingBillSnapshots(db, registerId))
}

/**
 * Atomically replaces `bill_snapshot` from a pull `bills` block and synchronizes lease/status
 * on any local `bill` rows without overwriting higher local sequences (ARCH §4.3.3).
 */
export async function applyBillsSnapshotBlock(
  db: SolvaDb,
  block: BillsSnapshotBlock,
  currentDeviceId?: string,
): Promise<void> {
  const selfDeviceId = currentDeviceId ?? (await getMeta(db, 'device'))?.device_id ?? ''
  const snapshotMap = new Map(block.rows.map((r) => [r.bill_id, r]))

  await db.transaction(
    'rw',
    [db.bill_snapshot, db.bill, db.bill_item, db.bill_item_modifier, db.meta],
    async (tx) => {
      const snapTable: Table<BillSnapshotRecord, string> = tx.table('bill_snapshot')
      const billTable: Table<BillRecord, string> = tx.table('bill')

      await snapTable.clear()
      if (block.rows.length > 0) {
        const sanitized: BillSnapshotRecord[] = block.rows.map((r) => ({
          bill_id: r.bill_id,
          table_id: r.table_id,
          bill_ref: r.bill_ref,
          status: r.status,
          lease_device_id: r.lease_device_id,
          lease_register_id: r.lease_register_id,
          is_awaiting_payment: r.is_awaiting_payment,
          handover_status: r.handover_status,
          handover_target_register_id: r.handover_target_register_id ?? null,
          last_event_seq: r.last_event_seq,
          last_event_at: r.last_event_at ?? null,
          bill_discount_type: r.bill_discount_type ?? null,
          bill_discount_pct: r.bill_discount_pct ?? null,
          bill_discount_input: r.bill_discount_input ?? null,
          bill_discount_approved_by: r.bill_discount_approved_by ?? null,
          customer_name: r.customer_name ?? null,
          split_mode: r.split_mode ?? null,
          parent_bill_id: r.parent_bill_id ?? null,
          share_index: r.share_index ?? null,
          share_count: r.share_count ?? null,
          items: r.items.map((it) => ({
            ...it,
            modifiers: it.modifiers.map((m) => ({ ...m })),
          })),
        }))
        await snapTable.bulkPut(sanitized)
      }

      const localOpenBills = await billTable.where('status').equals('OPEN').toArray()
      for (const local of localOpenBills) {
        const remote = snapshotMap.get(local.id)
        if (remote) {
          if (selfDeviceId && remote.lease_device_id !== selfDeviceId) {
            await billTable.update(local.id, {
              lease_device_id: remote.lease_device_id,
              lease_register_id: remote.lease_register_id,
              handover_status: remote.handover_status,
              handover_target_register_id: remote.handover_target_register_id ?? null,
              is_awaiting_payment: remote.is_awaiting_payment,
              last_event_seq: Math.max(local.last_event_seq, remote.last_event_seq),
              last_event_at: remote.last_event_at ?? local.last_event_at,
            })
          }
        } else if (selfDeviceId && local.lease_device_id !== selfDeviceId) {
          // Bill was handed off to another device and is no longer OPEN on server (paid/canceled).
          await billTable.update(local.id, {
            status: 'PAID',
            handover_status: 'NONE',
            handover_target_register_id: null,
            closed_at: block.as_of_server_time,
          })
        }
      }

      await setMeta(tx, 'bills_snapshot_meta', {
        etag: block.etag,
        as_of_server_time: block.as_of_server_time,
      })
    },
  )
}

/**
 * Materializes a full bill from `GET /api/pos/v1/bills/{id}` into local `bill`, `bill_item`,
 * `bill_item_modifier`, and seeds `local_counter` bill_seq = `detail.last_event_seq` after `AcceptBill`.
 */
export async function materializeAcceptedBill(
  db: SolvaDb,
  detail: BillDetailResponse,
): Promise<BillRecord> {
  const billRecord: BillRecord = {
    id: detail.id,
    tenant_id: detail.tenant_id,
    outlet_id: detail.outlet_id,
    register_id: detail.register_id,
    device_id: detail.device_id,
    table_id: detail.table_id,
    bill_ref: detail.bill_ref,
    status: detail.status,
    lease_device_id: detail.lease_device_id,
    lease_register_id: detail.lease_register_id,
    handover_status: detail.handover_status,
    handover_target_register_id: detail.handover_target_register_id ?? null,
    handover_event_id: detail.handover_event_id ?? null,
    handover_requested_at: detail.handover_requested_at ?? null,
    prebill_seq: detail.prebill_seq ?? null,
    prebill_printed_at: detail.prebill_printed_at ?? null,
    last_content_seq: detail.last_content_seq,
    is_awaiting_payment: detail.is_awaiting_payment,
    split_mode: detail.split_mode ?? null,
    parent_bill_id: detail.parent_bill_id ?? null,
    share_index: detail.share_index ?? null,
    share_count: detail.share_count ?? null,
    bill_discount_type: detail.bill_discount_type ?? null,
    bill_discount_pct: detail.bill_discount_pct ?? null,
    bill_discount_input: detail.bill_discount_input ?? null,
    bill_discount_approved_by: detail.bill_discount_approved_by ?? null,
    customer_name: detail.customer_name ?? null,
    customer_phone: detail.customer_phone ?? null,
    last_event_seq: detail.last_event_seq,
    last_event_at: detail.last_event_at ?? null,
    created_by: detail.created_by,
    created_at_device: detail.created_at_device,
    occurred_at: detail.occurred_at,
    business_date: detail.business_date,
    closed_at: null,
    sync_status: 'SYNCED',
  }

  const itemRecords: BillItemRecord[] = detail.items.map((it) => ({
    id: it.id,
    bill_id: detail.id,
    line_no: it.line_no,
    product_id: it.product_id ?? null,
    sku_id: it.sku_id,
    uom_id: it.uom_id,
    sku_code: it.sku_code,
    item_name: it.item_name,
    uom_code: it.uom_code,
    qty: it.qty,
    conversion_factor: it.conversion_factor,
    unit_price: it.unit_price,
    price_source: it.price_source,
    is_open_price: it.is_open_price,
    taxable: it.taxable,
    discount_type: it.discount_type ?? null,
    discount_pct: it.discount_pct ?? null,
    discount_input: it.discount_input ?? null,
    discount_approved_by: it.discount_approved_by ?? null,
    note: it.note ?? null,
    status: it.status,
    void_reason_text: it.void_reason_text ?? null,
    created_event_id: it.created_event_id ?? detail.id,
  }))

  const modRecords: BillItemModifierRecord[] = []
  for (const it of detail.items) {
    for (const m of it.modifiers) {
      modRecords.push({
        id: `${it.id}:${m.modifier_id}`,
        bill_item_id: it.id,
        modifier_id: m.modifier_id,
        name: m.name,
        price_delta: m.price_delta,
        qty: m.qty,
      })
    }
  }

  await db.transaction(
    'rw',
    [db.bill, db.bill_item, db.bill_item_modifier, db.bill_snapshot, db.local_counter],
    async (tx) => {
      const existingItems = await tx.table<BillItemRecord, string>('bill_item').where('bill_id').equals(detail.id).toArray()
      if (existingItems.length > 0) {
        await tx
          .table<BillItemModifierRecord, string>('bill_item_modifier')
          .where('bill_item_id')
          .anyOf(existingItems.map((i) => i.id))
          .delete()
        await tx.table<BillItemRecord, string>('bill_item').where('bill_id').equals(detail.id).delete()
      }

      await tx.table<BillRecord, string>('bill').put(billRecord)
      if (itemRecords.length > 0) {
        await tx.table<BillItemRecord, string>('bill_item').bulkPut(itemRecords)
      }
      if (modRecords.length > 0) {
        await tx.table<BillItemModifierRecord, string>('bill_item_modifier').bulkPut(modRecords)
      }

      await tx.table<BillSnapshotRecord, string>('bill_snapshot').delete(detail.id)
      await tx.table('local_counter').put({
        key: billSeqCounterKey(detail.id),
        register_id: detail.lease_register_id,
        doc_type: 'BILL_SEQ',
        period: null,
        last_seq: detail.last_event_seq,
        updated_at: detail.last_event_at ?? detail.occurred_at,
      })
    },
  )

  return billRecord
}
