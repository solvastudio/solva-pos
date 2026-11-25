import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { bill, billEvent } from '~/modules/fnb/public'
import type { BillEventEnvelopeV1 } from '~/modules/fnb/shared'
import { processPush } from '~/modules/sync/public'
import { handleBillAccept } from '~/routes/api/pos/v1/bills/accept'
import { handleBillHandover } from '~/routes/api/pos/v1/bills/handover'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { newTestId, setupFnbTenant } from './helpers/fnb'

describe('Bill concurrency & lock serialization (Phase 56)', () => {
  beforeEach(() => {
    resetLimitersForTests()
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    await closePools()
  })

  it('serializes concurrent AppendBillEvents + HandOverBill without deadlock or lost events', async () => {
    const f = await setupFnbTenant('bc-ser')
    const billId = newTestId()

    const ev1: BillEventEnvelopeV1 = {
      id: newTestId(),
      bill_id: billId,
      bill_seq: 1,
      device_id: f.waiterDev.deviceId,
      register_id: f.waiterRegId,
      device_seq: 1,
      staff_id: f.appUserId,
      event_type: 'BILL_OPENED',
      payload: { table_id: f.tableA1Id, bill_ref: 'M01-0001' },
      created_at_device: '2026-11-24T12:00:00.000Z',
      clock_offset_ms: 0,
      occurred_at: '2026-11-24T12:00:00.000Z',
      business_date: '2026-11-24',
      schema_version: 1,
    }
    const openRes = await processPush(
      f.waiterDev,
      {
        sent_at_device: '2026-11-24T12:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: newTestId(),
            type: 'AppendBillEvents',
            schema_version: 1,
            device_seq: 1,
            created_at_device: '2026-11-24T12:00:00.000Z',
            depends_on: [],
            payload: { bill_id: billId, events: [ev1] },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
    )
    expect(openRes.results[0]!.outcome).toBe('ACK')

    // Race an edit (seq 2) against handover expecting client_last_event_seq = 1
    const ev2: BillEventEnvelopeV1 = {
      id: newTestId(),
      bill_id: billId,
      bill_seq: 2,
      device_id: f.waiterDev.deviceId,
      register_id: f.waiterRegId,
      device_seq: 2,
      staff_id: f.appUserId,
      event_type: 'PREBILL_PRINTED',
      payload: {},
      created_at_device: '2026-11-24T12:01:00.000Z',
      clock_offset_ms: 0,
      occurred_at: '2026-11-24T12:01:00.000Z',
      business_date: '2026-11-24',
      schema_version: 1,
    }

    const [editRes, hoRes] = await Promise.all([
      processPush(
        f.waiterDev,
        {
          sent_at_device: '2026-11-24T12:01:00.000Z',
          clock_offset_ms: 0,
          commands: [
            {
              id: newTestId(),
              type: 'AppendBillEvents',
              schema_version: 1,
              device_seq: 2,
              created_at_device: '2026-11-24T12:01:00.000Z',
              depends_on: [],
              payload: { bill_id: billId, events: [ev2] },
            },
          ],
        },
        { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
      ),
      handleBillHandover(
        new Request('https://app.solva.test/api/pos/v1/bills/handover', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${f.waiterCredential}`,
            'X-Schema-Version': '1',
          },
          body: JSON.stringify({
            event_id: newTestId(),
            bill_id: billId,
            device_seq: 3,
            staff_id: f.appUserId,
            client_last_event_seq: 1,
            target_register_id: f.cashierRegId,
            created_at_device: '2026-11-24T12:01:00.000Z',
            clock_offset_ms: 0,
            schema_version: 1,
          }),
        }),
      ),
    ])

    // Exactly one of two consistent serializations must occur:
    // (a) edit committed first -> handover returned 409 EVENTS_PENDING
    // (b) handover committed first -> edit returned ATTENTION BILL_READ_ONLY
    if (hoRes.status === 409) {
      expect(editRes.results[0]!.outcome).toBe('ACK')
    } else {
      expect(hoRes.status).toBe(200)
      expect(editRes.results[0]!.outcome).toBe('ATTENTION')
      const acc = await handleBillAccept(
        new Request('https://app.solva.test/api/pos/v1/bills/accept', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${f.cashierCredential}`,
            'X-Schema-Version': '1',
          },
          body: JSON.stringify({
            event_id: newTestId(),
            bill_id: billId,
            device_seq: 1,
            staff_id: f.appUserId,
            client_last_event_seq: 2,
            created_at_device: '2026-11-24T12:02:00.000Z',
            clock_offset_ms: 0,
            schema_version: 1,
          }),
        }),
      )
      expect(acc.status).toBe(200)
    }

    await withTenant(f.tenantId, async (tx) => {
      const [b] = await tx.select().from(bill).where(eq(bill.id, billId))
      const evs = await tx.select().from(billEvent).where(eq(billEvent.billId, billId))
      expect(evs.length).toBe(b!.lastEventSeq)
    })
  })
})
