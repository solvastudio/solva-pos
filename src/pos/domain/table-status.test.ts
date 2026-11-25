import { describe, expect, it } from 'vitest'
import type { BillRecord, BillSnapshotRecord } from '../db/types'
import { deriveTableStatus, groupBillsByTable } from './table-status'

const DEV_SELF = '01950000-0000-7000-8000-000000000001'
const DEV_OTHER = '01950000-0000-7000-8000-000000000002'
const T5 = '01950000-0000-7000-8000-000000000005'

function makeLocalBill(overrides: Partial<BillRecord> = {}): BillRecord {
  return {
    id: '01950000-0000-7000-8000-000000000101',
    tenant_id: 't1',
    outlet_id: 'o1',
    register_id: 'r1',
    device_id: DEV_SELF,
    table_id: T5,
    bill_ref: 'M05-0001',
    status: 'OPEN',
    lease_device_id: DEV_SELF,
    lease_register_id: 'r1',
    handover_status: 'NONE',
    handover_target_register_id: null,
    handover_event_id: null,
    handover_requested_at: null,
    prebill_seq: null,
    prebill_printed_at: null,
    last_content_seq: 1,
    is_awaiting_payment: false,
    split_mode: null,
    parent_bill_id: null,
    share_index: null,
    share_count: null,
    bill_discount_type: null,
    bill_discount_pct: null,
    bill_discount_input: null,
    bill_discount_approved_by: null,
    customer_name: null,
    customer_phone: null,
    last_event_seq: 1,
    last_event_at: '2026-11-24T12:00:00.000Z',
    created_by: 'u1',
    created_at_device: '2026-11-24T12:00:00.000Z',
    occurred_at: '2026-11-24T12:00:00.000Z',
    business_date: '2026-11-24',
    closed_at: null,
    ...overrides,
  }
}

function makeSnapBill(overrides: Partial<BillSnapshotRecord> = {}): BillSnapshotRecord {
  return {
    bill_id: '01950000-0000-7000-8000-000000000201',
    table_id: T5,
    bill_ref: 'M05-0002',
    status: 'OPEN',
    lease_device_id: DEV_OTHER,
    lease_register_id: 'r2',
    is_awaiting_payment: false,
    handover_status: 'NONE',
    handover_target_register_id: null,
    last_event_seq: 2,
    last_event_at: '2026-11-24T12:05:00.000Z',
    bill_discount_type: null,
    bill_discount_pct: null,
    bill_discount_input: null,
    bill_discount_approved_by: null,
    customer_name: null,
    items: [],
    ...overrides,
  }
}

describe('pos/domain/table-status', () => {
  it('returns EMPTY when table has no OPEN bills', () => {
    const res = deriveTableStatus(T5, [makeLocalBill({ status: 'PAID' })], [], DEV_SELF)
    expect(res.status).toBe('EMPTY')
    expect(res.billCount).toBe(0)
  })

  it('transitions EMPTY -> OCCUPIED -> AWAITING_PAYMENT -> OCCUPIED on prebill and subsequent item add', () => {
    const bill = makeLocalBill({ is_awaiting_payment: false, last_content_seq: 2, prebill_seq: null })
    expect(deriveTableStatus(T5, [bill], [], DEV_SELF).status).toBe('OCCUPIED')

    const prebilled = makeLocalBill({ is_awaiting_payment: true, last_content_seq: 2, prebill_seq: 3 })
    expect(deriveTableStatus(T5, [prebilled], [], DEV_SELF).status).toBe('AWAITING_PAYMENT')

    const afterAdd = makeLocalBill({ is_awaiting_payment: false, last_content_seq: 4, prebill_seq: 3 })
    expect(deriveTableStatus(T5, [afterAdd], [], DEV_SELF).status).toBe('OCCUPIED')
  })

  it('returns LOCKED_OTHER for other-device OPEN bill and prioritizes OCCUPIED when mixed with own bill', () => {
    const other = makeSnapBill({ is_awaiting_payment: false })
    expect(deriveTableStatus(T5, [], [other], DEV_SELF).status).toBe('LOCKED_OTHER')

    const own = makeLocalBill({ is_awaiting_payment: true })
    const mixed = deriveTableStatus(T5, [own], [other], DEV_SELF)
    expect(mixed.status).toBe('OCCUPIED')
    expect(mixed.billCount).toBe(2)
  })

  it('groups bills across tables cleanly and treats all awaiting_payment bills as AWAITING_PAYMENT', () => {
    const ownAwait = makeLocalBill({ is_awaiting_payment: true })
    const otherAwait = makeSnapBill({ is_awaiting_payment: true })
    const map = groupBillsByTable([T5, 'empty-table'], [ownAwait], [otherAwait], DEV_SELF)
    expect(map.get(T5)?.status).toBe('AWAITING_PAYMENT')
    expect(map.get(T5)?.billCount).toBe(2)
    expect(map.get('empty-table')?.status).toBe('EMPTY')
  })
})
