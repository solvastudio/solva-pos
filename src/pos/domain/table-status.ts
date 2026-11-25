import type { BillRecord, BillSnapshotRecord } from '../db/types'

export type DerivedTableStatusKind = 'EMPTY' | 'OCCUPIED' | 'AWAITING_PAYMENT' | 'LOCKED_OTHER'

export interface TableOpenBillEntry {
  readonly billId: string
  readonly tableId: string
  readonly billRef: string
  readonly leaseDeviceId: string
  readonly leaseRegisterId: string
  readonly isAwaitingPayment: boolean
  readonly handoverStatus: 'NONE' | 'PENDING'
  readonly lastEventSeq: number
  readonly lastEventAt: string | null
  readonly source: 'local' | 'snapshot'
}

export interface DerivedTableStatus {
  readonly status: DerivedTableStatusKind
  readonly billCount: number
  readonly updatedAt: string | null
  readonly bills: readonly TableOpenBillEntry[]
}

function mergeOpenBills(
  localBills: readonly BillRecord[],
  snapshotBills: readonly BillSnapshotRecord[],
): TableOpenBillEntry[] {
  const byId = new Map<string, TableOpenBillEntry>()

  for (const b of localBills) {
    if (b.status !== 'OPEN') continue
    byId.set(b.id, {
      billId: b.id,
      tableId: b.table_id,
      billRef: b.bill_ref,
      leaseDeviceId: b.lease_device_id,
      leaseRegisterId: b.lease_register_id,
      isAwaitingPayment: Boolean(b.is_awaiting_payment),
      handoverStatus: b.handover_status,
      lastEventSeq: b.last_event_seq,
      lastEventAt: b.last_event_at,
      source: 'local',
    })
  }

  for (const s of snapshotBills) {
    if (s.status !== 'OPEN') continue
    const existing = byId.get(s.bill_id)
    // Snapshot wins when newer seq OR same seq with different lease (e.g., handover accepted on another device).
    if (
      !existing ||
      s.last_event_seq > existing.lastEventSeq ||
      (s.last_event_seq === existing.lastEventSeq && s.lease_device_id !== existing.leaseDeviceId)
    ) {
      byId.set(s.bill_id, {
        billId: s.bill_id,
        tableId: s.table_id,
        billRef: s.bill_ref,
        leaseDeviceId: s.lease_device_id,
        leaseRegisterId: s.lease_register_id,
        isAwaitingPayment: Boolean(s.is_awaiting_payment),
        handoverStatus: s.handover_status,
        lastEventSeq: s.last_event_seq,
        lastEventAt: s.last_event_at,
        source: 'snapshot',
      })
    }
  }

  return [...byId.values()]
}

/**
 * Derives table card visual status strictly from merged local + snapshot OPEN bills
 * (`BR-FNB-001/007/010`, `DESIGN §2.1.6`). Mixed own/other bills prioritize `OCCUPIED`.
 */
export function deriveTableStatus(
  tableId: string,
  localBills: readonly BillRecord[],
  snapshotBills: readonly BillSnapshotRecord[],
  currentDeviceId: string,
): DerivedTableStatus {
  const bills = mergeOpenBills(
    localBills.filter((b) => b.table_id === tableId),
    snapshotBills.filter((s) => s.table_id === tableId),
  )

  if (bills.length === 0) {
    return { status: 'EMPTY', billCount: 0, updatedAt: null, bills: [] }
  }

  let updatedAt: string | null = null
  for (const b of bills) {
    if (b.lastEventAt && (!updatedAt || b.lastEventAt > updatedAt)) {
      updatedAt = b.lastEventAt
    }
  }

  const allAwaitingPayment = bills.every((b) => b.isAwaitingPayment)
  if (allAwaitingPayment) {
    return {
      status: 'AWAITING_PAYMENT',
      billCount: bills.length,
      updatedAt,
      bills,
    }
  }

  const hasOwn = bills.some((b) => b.leaseDeviceId === currentDeviceId)
  if (!hasOwn) {
    return {
      status: 'LOCKED_OTHER',
      billCount: bills.length,
      updatedAt,
      bills,
    }
  }

  return {
    status: 'OCCUPIED',
    billCount: bills.length,
    updatedAt,
    bills,
  }
}

export function groupBillsByTable(
  tableIds: readonly string[],
  localBills: readonly BillRecord[],
  snapshotBills: readonly BillSnapshotRecord[],
  currentDeviceId: string,
): Map<string, DerivedTableStatus> {
  const out = new Map<string, DerivedTableStatus>()
  const merged = mergeOpenBills(localBills, snapshotBills)
  const byTable = new Map<string, TableOpenBillEntry[]>()

  for (const b of merged) {
    const arr = byTable.get(b.tableId) ?? []
    arr.push(b)
    byTable.set(b.tableId, arr)
  }

  for (const tableId of tableIds) {
    const tableBills = byTable.get(tableId) ?? []
    if (tableBills.length === 0) {
      out.set(tableId, { status: 'EMPTY', billCount: 0, updatedAt: null, bills: [] })
      continue
    }
    let updatedAt: string | null = null
    for (const b of tableBills) {
      if (b.lastEventAt && (!updatedAt || b.lastEventAt > updatedAt)) {
        updatedAt = b.lastEventAt
      }
    }
    const allAwaiting = tableBills.every((b) => b.isAwaitingPayment)
    const hasOwn = tableBills.some((b) => b.leaseDeviceId === currentDeviceId)
    const status: DerivedTableStatusKind = allAwaiting
      ? 'AWAITING_PAYMENT'
      : hasOwn
        ? 'OCCUPIED'
        : 'LOCKED_OTHER'
    out.set(tableId, {
      status,
      billCount: tableBills.length,
      updatedAt,
      bills: tableBills,
    })
  }
  return out
}
