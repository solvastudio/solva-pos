import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createRegister, revokeDevice } from '~/modules/identity/public'
import { bill, billEvent } from '~/modules/fnb/public'
import type { BillEventEnvelopeV1 } from '~/modules/fnb/shared'
import { processPush } from '~/modules/sync/public'
import { idempotencyCommand } from '~/modules/sync/server/schema'
import { handleBillAccept } from '~/routes/api/pos/v1/bills/accept'
import { handleBillHandover } from '~/routes/api/pos/v1/bills/handover'
import { handleBillHandoverCancel } from '~/routes/api/pos/v1/bills/handover.cancel'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { newTestId, setupFnbTenant, withFnbAppTx } from './helpers/fnb'

function httpReq(url: string, credential: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential}`,
      'X-Schema-Version': '1',
      'X-App-Version': 'v1.6.0',
      'X-Sync-Protocol': '1',
    },
    body: JSON.stringify(body),
  })
}

async function openSampleBillWithEvents(
  f: Awaited<ReturnType<typeof setupFnbTenant>>,
  count = 6,
): Promise<string> {
  const billId = newTestId()
  const events: BillEventEnvelopeV1[] = [
    {
      id: newTestId(),
      bill_id: billId,
      bill_seq: 1,
      device_id: f.waiterDev.deviceId,
      register_id: f.waiterRegId,
      device_seq: 1,
      staff_id: f.appUserId,
      event_type: 'BILL_OPENED',
      payload: { table_id: f.tableA1Id, bill_ref: 'M05-0003' },
      created_at_device: '2026-11-24T12:00:00.000Z',
      clock_offset_ms: 0,
      occurred_at: '2026-11-24T12:00:00.000Z',
      business_date: '2026-11-24',
      schema_version: 1,
      app_version: 'v1.6.0',
    },
  ]
  for (let seq = 2; seq <= count; seq += 1) {
    events.push({
      id: newTestId(),
      bill_id: billId,
      bill_seq: seq,
      device_id: f.waiterDev.deviceId,
      register_id: f.waiterRegId,
      device_seq: seq,
      staff_id: f.appUserId,
      event_type: 'ITEM_ADDED',
      payload: {
        item_id: newTestId(),
        line_no: seq - 1,
        sku_id: f.menuSkuId,
        uom_id: f.pcsUomId,
        sku_code: 'NASGOR-01',
        item_name: 'Nasi Goreng',
        uom_code: 'pcs',
        qty: '1',
        conversion_factor: '1',
        unit_price: 35000,
        price_source: 'TENANT_DEFAULT',
        is_open_price: false,
        taxable: true,
        modifiers: [],
      },
      created_at_device: `2026-11-24T12:0${seq}:00.000Z`,
      clock_offset_ms: 0,
      occurred_at: `2026-11-24T12:0${seq}:00.000Z`,
      business_date: '2026-11-24',
      schema_version: 1,
      app_version: 'v1.6.0',
    })
  }
  const res = await processPush(
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
          payload: { bill_id: billId, events },
        },
      ],
    },
    { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
  )
  expect(res.results[0]!.outcome).toBe('ACK')
  return billId
}

describe('Online bill handover, accept, cancel, EC-059/EC-061 (Phase 56)', () => {
  beforeEach(() => {
    resetLimitersForTests()
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    await closePools()
  })

  it('FLOW-19 M05-0003: 6 events -> handover -> accept transfers lease, blocks sender edits, and replay is idempotent', async () => {
    const f = await setupFnbTenant('ho-flow19')
    const billId = await openSampleBillWithEvents(f, 6)

    // EC-059: client_last_event_seq < server 6 -> 409 EVENTS_PENDING and no idempotency row stored
    const staleEvId = newTestId()
    const staleRes = await handleBillHandover(
      httpReq('https://app.solva.test/api/pos/v1/bills/handover', f.waiterCredential, {
        event_id: staleEvId,
        bill_id: billId,
        device_seq: 10,
        staff_id: f.appUserId,
        client_last_event_seq: 5,
        target_register_id: f.cashierRegId,
        created_at_device: '2026-11-24T12:10:00.000Z',
        clock_offset_ms: 0,
        schema_version: 1,
        app_version: 'v1.6.0',
      }),
    )
    expect(staleRes.status).toBe(409)
    expect(await staleRes.json()).toMatchObject({ error: { code: 'EVENTS_PENDING' } })

    await withTenant(f.tenantId, async (tx) => {
      const rows = await tx.select().from(idempotencyCommand).where(eq(idempotencyCommand.commandId, staleEvId))
      expect(rows).toHaveLength(0)
    })

    // Valid handover
    const hoEvId = newTestId()
    const hoPayload = {
      event_id: hoEvId,
      bill_id: billId,
      device_seq: 11,
      staff_id: f.appUserId,
      client_last_event_seq: 6,
      target_register_id: f.cashierRegId,
      created_at_device: '2026-11-24T12:11:00.000Z',
      clock_offset_ms: 0,
      schema_version: 1,
      app_version: 'v1.6.0',
    }
    const hoRes = await handleBillHandover(
      httpReq('https://app.solva.test/api/pos/v1/bills/handover', f.waiterCredential, hoPayload),
    )
    expect(hoRes.status).toBe(200)
    expect(hoRes.headers.get('Cache-Control')).toBe('no-store')
    const hoBody = await hoRes.json()
    expect(hoBody).toMatchObject({ bill_id: billId, bill_seq: 7, status: 'ACK', last_event_seq: 7 })

    // Replay returns cached ACK
    const hoReplay = await handleBillHandover(
      httpReq('https://app.solva.test/api/pos/v1/bills/handover', f.waiterCredential, hoPayload),
    )
    expect(hoReplay.status).toBe(200)
    expect(await hoReplay.json()).toMatchObject({ bill_seq: 7, status: 'ACK' })

    // Sender cannot edit while PENDING
    const pendingEdit = await processPush(
      f.waiterDev,
      {
        sent_at_device: '2026-11-24T12:12:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: newTestId(),
            type: 'AppendBillEvents',
            schema_version: 1,
            device_seq: 20,
            created_at_device: '2026-11-24T12:12:00.000Z',
            depends_on: [],
            payload: {
              bill_id: billId,
              events: [
                {
                  id: newTestId(),
                  bill_id: billId,
                  bill_seq: 8,
                  device_id: f.waiterDev.deviceId,
                  register_id: f.waiterRegId,
                  device_seq: 12,
                  staff_id: f.appUserId,
                  event_type: 'PREBILL_PRINTED',
                  payload: {},
                  created_at_device: '2026-11-24T12:12:00.000Z',
                  clock_offset_ms: 0,
                  occurred_at: '2026-11-24T12:12:00.000Z',
                  business_date: '2026-11-24',
                  schema_version: 1,
                },
              ],
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
    )
    expect(pendingEdit.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_code: 'BILL_READ_ONLY',
    })

    // Cashier accepts -> bill_seq 8, lease transfers to cashierDev/cashierRegId
    const accRes = await handleBillAccept(
      httpReq('https://app.solva.test/api/pos/v1/bills/accept', f.cashierCredential, {
        event_id: newTestId(),
        bill_id: billId,
        device_seq: 1,
        staff_id: f.appUserId,
        client_last_event_seq: 7,
        created_at_device: '2026-11-24T12:13:00.000Z',
        clock_offset_ms: 0,
        schema_version: 1,
        app_version: 'v1.6.0',
      }),
    )
    expect(accRes.status).toBe(200)
    expect(await accRes.json()).toMatchObject({
      bill_id: billId,
      bill_seq: 8,
      status: 'ACK',
      lease_register_id: f.cashierRegId,
    })

    await withTenant(f.tenantId, async (tx) => {
      const [b] = await tx.select().from(bill).where(eq(bill.id, billId))
      expect(b!.leaseDeviceId).toBe(f.cashierDev.deviceId)
      expect(b!.leaseRegisterId).toBe(f.cashierRegId)
      expect(b!.handoverStatus).toBe('NONE')

      const [cmdRow] = await tx.select().from(idempotencyCommand).where(eq(idempotencyCommand.commandId, hoEvId))
      expect(cmdRow!.channel).toBe('ONLINE')
      expect(cmdRow!.deviceSeq).toBeNull()
    })

    // Waiter rejected after accept
    const postAcceptWaiter = await processPush(
      f.waiterDev,
      {
        sent_at_device: '2026-11-24T12:14:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: newTestId(),
            type: 'AppendBillEvents',
            schema_version: 1,
            device_seq: 21,
            created_at_device: '2026-11-24T12:14:00.000Z',
            depends_on: [],
            payload: {
              bill_id: billId,
              events: [
                {
                  id: newTestId(),
                  bill_id: billId,
                  bill_seq: 9,
                  device_id: f.waiterDev.deviceId,
                  register_id: f.waiterRegId,
                  device_seq: 13,
                  staff_id: f.appUserId,
                  event_type: 'PREBILL_PRINTED',
                  payload: {},
                  created_at_device: '2026-11-24T12:14:00.000Z',
                  clock_offset_ms: 0,
                  occurred_at: '2026-11-24T12:14:00.000Z',
                  business_date: '2026-11-24',
                  schema_version: 1,
                },
              ],
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
    )
    expect(postAcceptWaiter.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_code: 'NOT_LEASE_HOLDER',
    })

    // Trigger guard blocks direct lease update without GUC
    await expect(
      withFnbAppTx(f.tenantId, (c) =>
        c.query(`UPDATE bill SET lease_device_id = $2, lease_register_id = $3 WHERE id = $1`, [
          billId,
          f.waiterDev.deviceId,
          f.waiterRegId,
        ]),
      ),
    ).rejects.toThrow(/bill_lease_immutable/)
  })

  it('EC-061: concurrent accept and cancel settle atomically — one 200 ACK and one 409 HANDOVER_NOT_PENDING', async () => {
    const f = await setupFnbTenant('ho-ec061')
    const billId = await openSampleBillWithEvents(f, 2)

    const ho = await handleBillHandover(
      httpReq('https://app.solva.test/api/pos/v1/bills/handover', f.waiterCredential, {
        event_id: newTestId(),
        bill_id: billId,
        device_seq: 5,
        staff_id: f.appUserId,
        client_last_event_seq: 2,
        target_register_id: f.cashierRegId,
        created_at_device: '2026-11-24T12:05:00.000Z',
        clock_offset_ms: 0,
        schema_version: 1,
      }),
    )
    expect(ho.status).toBe(200)

    const [rAccept, rCancel] = await Promise.all([
      handleBillAccept(
        httpReq('https://app.solva.test/api/pos/v1/bills/accept', f.cashierCredential, {
          event_id: newTestId(),
          bill_id: billId,
          device_seq: 1,
          staff_id: f.appUserId,
          client_last_event_seq: 3,
          created_at_device: '2026-11-24T12:06:00.000Z',
          clock_offset_ms: 0,
          schema_version: 1,
        }),
      ),
      handleBillHandoverCancel(
        httpReq('https://app.solva.test/api/pos/v1/bills/handover/cancel', f.waiterCredential, {
          event_id: newTestId(),
          bill_id: billId,
          device_seq: 6,
          staff_id: f.appUserId,
          client_last_event_seq: 3,
          created_at_device: '2026-11-24T12:06:00.000Z',
          clock_offset_ms: 0,
          schema_version: 1,
        }),
      ),
    ])

    const statuses = [rAccept.status, rCancel.status].sort((a, b) => a - b)
    expect(statuses).toEqual([200, 409])
    const loser = rAccept.status === 409 ? rAccept : rCancel
    expect(await loser.json()).toMatchObject({ error: { code: 'HANDOVER_NOT_PENDING' } })

    await withTenant(f.tenantId, async (tx) => {
      const [b] = await tx.select().from(bill).where(eq(bill.id, billId))
      expect(b!.handoverStatus).toBe('NONE')
      expect(b!.lastEventSeq).toBe(4)
      const expectedHolder = rAccept.status === 200 ? f.cashierRegId : f.waiterRegId
      expect(b!.leaseRegisterId).toBe(expectedHolder)
      const evs = await tx.select().from(billEvent).where(eq(billEvent.billId, billId))
      expect(evs).toHaveLength(4)
    })
  })

  it('rejects invalid handover targets, revoked sender on accept, supports cancel+rehandover, and rate limits', async () => {
    const f = await setupFnbTenant('ho-val')
    const billId = await openSampleBillWithEvents(f, 2)

    const emptyCashier = await createRegister(f.actor, {
      outletId: f.outletA,
      code: 'CAS2',
      name: 'Unpaired Cashier',
      registerType: 'CASHIER',
      invoicePrefix: 'CAS2',
    })
    const outletBCashier = await createRegister(f.actor, {
      outletId: f.outletB,
      code: 'CASB',
      name: 'Outlet B Cashier',
      registerType: 'CASHIER',
      invoicePrefix: 'CASB',
    })

    // Target is WAITER / unpaired / other outlet -> 400 VALIDATION_FAILED
    for (const badTarget of [f.waiterRegId, emptyCashier.id, outletBCashier.id]) {
      const badRes = await handleBillHandover(
        httpReq('https://app.solva.test/api/pos/v1/bills/handover', f.waiterCredential, {
          event_id: newTestId(),
          bill_id: billId,
          device_seq: 10,
          staff_id: f.appUserId,
          client_last_event_seq: 2,
          target_register_id: badTarget,
          created_at_device: '2026-11-24T12:10:00.000Z',
          clock_offset_ms: 0,
          schema_version: 1,
        }),
      )
      expect(badRes.status).toBe(400)
    }

    // Handover -> Cancel -> Re-handover -> Revoke sender -> Accept fails
    const ho1 = await handleBillHandover(
      httpReq('https://app.solva.test/api/pos/v1/bills/handover', f.waiterCredential, {
        event_id: newTestId(),
        bill_id: billId,
        device_seq: 11,
        staff_id: f.appUserId,
        client_last_event_seq: 2,
        target_register_id: f.cashierRegId,
        created_at_device: '2026-11-24T12:11:00.000Z',
        clock_offset_ms: 0,
        schema_version: 1,
      }),
    )
    expect(ho1.status).toBe(200)

    const cancel1 = await handleBillHandoverCancel(
      httpReq('https://app.solva.test/api/pos/v1/bills/handover/cancel', f.waiterCredential, {
        event_id: newTestId(),
        bill_id: billId,
        device_seq: 12,
        staff_id: f.appUserId,
        client_last_event_seq: 3,
        created_at_device: '2026-11-24T12:12:00.000Z',
        clock_offset_ms: 0,
        schema_version: 1,
      }),
    )
    expect(cancel1.status).toBe(200)

    const ho2 = await handleBillHandover(
      httpReq('https://app.solva.test/api/pos/v1/bills/handover', f.waiterCredential, {
        event_id: newTestId(),
        bill_id: billId,
        device_seq: 13,
        staff_id: f.appUserId,
        client_last_event_seq: 4,
        target_register_id: f.cashierRegId,
        created_at_device: '2026-11-24T12:13:00.000Z',
        clock_offset_ms: 0,
        schema_version: 1,
      }),
    )
    expect(ho2.status).toBe(200)

    await revokeDevice(f.actor, { deviceId: f.waiterDev.deviceId, reasonCode: 'OTHER' })
    const accAfterRevoke = await handleBillAccept(
      httpReq('https://app.solva.test/api/pos/v1/bills/accept', f.cashierCredential, {
        event_id: newTestId(),
        bill_id: billId,
        device_seq: 1,
        staff_id: f.appUserId,
        client_last_event_seq: 5,
        created_at_device: '2026-11-24T12:14:00.000Z',
        clock_offset_ms: 0,
        schema_version: 1,
      }),
    )
    expect(accAfterRevoke.status).toBe(400)

    // Light rate-limit check on deviceHandover (30/min default)
    let saw429 = false
    for (let i = 0; i < 40; i += 1) {
      const r = await handleBillAccept(
        httpReq('https://app.solva.test/api/pos/v1/bills/accept', f.cashierCredential, {
          event_id: newTestId(),
          bill_id: billId,
          device_seq: 100 + i,
          staff_id: f.appUserId,
          client_last_event_seq: 5,
          created_at_device: '2026-11-24T12:15:00.000Z',
          clock_offset_ms: 0,
          schema_version: 1,
        }),
      )
      if (r.status === 429) {
        expect(r.headers.get('Retry-After')).toBeTruthy()
        saw429 = true
        break
      }
    }
    expect(saw429).toBe(true)
  })
})
