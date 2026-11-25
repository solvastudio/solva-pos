import { afterEach, describe, expect, it } from 'vitest'
import { getMeta, setMeta } from '../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { applyPulledBillsBlock } from './bills-block'

const T1 = '01950000-0000-7000-8000-00000000c201'
const DEV1 = '01950000-0000-7000-8000-00000000d201'
const DEV2 = '01950000-0000-7000-8000-00000000d202'
const REG2 = '01950000-0000-7000-8000-00000000r202'
const BILL1 = '01950000-0000-7000-8000-00000000b201'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/sync/bills-block', () => {
  it('replaces snapshot store, updates lease on handed-off local bill without shrinking higher local seq, and ignores unchanged', async () => {
    const db = await openTenantDb(T1)
    await setMeta(db, 'device', {
      device_id: DEV1,
      credential: 'cred',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'warung',
      register_id: 'reg-1',
      outlet_id: 'out-1',
      register_type: 'WAITER',
    })

    await db.bill.put({
      id: BILL1,
      tenant_id: T1,
      outlet_id: 'out-1',
      register_id: 'reg-1',
      device_id: DEV1,
      table_id: '01950000-0000-7000-8000-00000000a201',
      bill_ref: 'M05-0001',
      status: 'OPEN',
      lease_device_id: DEV1,
      lease_register_id: 'reg-1',
      handover_status: 'PENDING',
      handover_target_register_id: REG2,
      handover_event_id: null,
      handover_requested_at: null,
      prebill_seq: null,
      prebill_printed_at: null,
      last_content_seq: 2,
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
      last_event_seq: 5,
      last_event_at: '2026-11-24T12:00:00.000Z',
      created_by: 'u1',
      created_at_device: '2026-11-24T12:00:00.000Z',
      occurred_at: '2026-11-24T12:00:00.000Z',
      business_date: '2026-11-24',
      closed_at: null,
    })

    await applyPulledBillsBlock(
      db,
      {
        etag: '0123456789abcdef',
        as_of_server_time: '2026-11-24T12:05:00.000Z',
        rows: [
          {
            bill_id: BILL1,
            table_id: '01950000-0000-7000-8000-00000000a201',
            bill_ref: 'M05-0001',
            status: 'OPEN',
            lease_device_id: DEV2,
            lease_register_id: REG2,
            is_awaiting_payment: false,
            handover_status: 'NONE',
            handover_target_register_id: null,
            last_event_seq: 4,
            last_event_at: '2026-11-24T12:04:00.000Z',
            bill_discount_type: null,
            bill_discount_pct: null,
            bill_discount_input: null,
            bill_discount_approved_by: null,
            customer_name: null,
            items: [],
          },
        ],
      },
      DEV1,
    )

    const updatedLocal = await db.bill.get(BILL1)
    expect(updatedLocal!.lease_device_id).toBe(DEV2)
    expect(updatedLocal!.handover_status).toBe('NONE')
    // Preserves higher local last_event_seq
    expect(updatedLocal!.last_event_seq).toBe(5)
    expect((await getMeta(db, 'bills_snapshot_meta'))?.etag).toBe('0123456789abcdef')

    // Unchanged does nothing
    await applyPulledBillsBlock(db, 'unchanged', DEV1)
    expect(await db.bill_snapshot.count()).toBe(1)

    // Subsequent snapshot without BILL1 marks externally-paid local bill as PAID
    await applyPulledBillsBlock(
      db,
      {
        etag: 'fedcba9876543210',
        as_of_server_time: '2026-11-24T12:10:00.000Z',
        rows: [],
      },
      DEV1,
    )
    expect((await db.bill.get(BILL1))!.status).toBe('PAID')
  })
})
