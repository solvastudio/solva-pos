import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createModifier, createModifierGroup } from '~/modules/catalog/public'
import { createTable } from '~/modules/fnb/public'
import type { BillEventEnvelopeV1 } from '~/modules/fnb/shared'
import { createPairingCode, createRegister, enrollDevice } from '~/modules/identity/public'
import { handlePull, processPush } from '~/modules/sync/public'
import { handleBillHandover } from '~/routes/api/pos/v1/bills/handover'
import { handleGetBillDetail } from '~/routes/api/pos/v1/bills/$id'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { newTestId, setupFnbTenant } from './helpers/fnb'

function pushEnvelope(cmdId: string, deviceSeq: number, billId: string, events: BillEventEnvelopeV1[]) {
  return {
    sent_at_device: events[0]!.created_at_device,
    clock_offset_ms: 0,
    commands: [
      {
        id: cmdId,
        type: 'AppendBillEvents' as const,
        schema_version: 1,
        device_seq: deviceSeq,
        depends_on: [],
        created_at_device: events[0]!.created_at_device,
        app_version: 'v1.6.0',
        payload: {
          bill_id: billId,
          events,
        },
      },
    ],
  }
}

describe('integration: fnb bills snapshot, pull block, and GET bill detail', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('excludes own bills, returns other-device bills + incoming flag, strips phone, keeps stable etag, and isolates outlets/tenants on GET /bills/{id}', async () => {
    const f = await setupFnbTenant('snap')
    const secondTenant = await setupFnbTenant('snap-other')

    const tableA2 = await createTable(f.fnbActor, {
      outletId: f.outletA,
      area: 'Main',
      code: 'A2',
      capacity: 4,
    })
    const modGroup = await createModifierGroup(f.catalogActor, {
      name: 'Toppings',
      selectionType: 'MULTI',
      minSelect: 0,
      maxSelect: 3,
    })
    const extraMod = await createModifier(f.catalogActor, {
      modifierGroupId: modGroup.id,
      name: 'Extra Sambal',
      priceDelta: 2000,
    })

    const otherCashierReg = await createRegister(f.actor, {
      outletId: f.outletA,
      code: 'POS02',
      name: 'Kasir 2',
      registerType: 'CASHIER',
      invoicePrefix: 'POS02',
    })
    const pair2 = await createPairingCode(f.actor, otherCashierReg.id)
    const enr2 = await enrollDevice(
      { slug: f.slug, code: pair2.code, device_name: 'Kasir-2' },
      '10.10.0.9',
      { minDelayMs: 0 },
    )

    // 1. Waiter opens Bill A on table A1 with customer phone & item + modifier
    const billAId = newTestId()
    const itemAId = newTestId()
    const resWaiter = await processPush(
      f.waiterDev,
      pushEnvelope(newTestId(), 1, billAId, [
        {
          id: newTestId(),
          bill_id: billAId,
          bill_seq: 1,
          device_id: f.waiterDev.deviceId,
          register_id: f.waiterRegId,
          device_seq: 1,
          staff_id: f.appUserId,
          event_type: 'BILL_OPENED',
          payload: {
            table_id: f.tableA1Id,
            bill_ref: 'A1-0001',
            customer_name: 'Ibu Sari',
            customer_phone: '08123456789',
          },
          created_at_device: '2026-11-24T12:00:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-24T12:00:00.000Z',
          business_date: '2026-11-24',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
        {
          id: newTestId(),
          bill_id: billAId,
          bill_seq: 2,
          device_id: f.waiterDev.deviceId,
          register_id: f.waiterRegId,
          device_seq: 2,
          staff_id: f.appUserId,
          event_type: 'ITEM_ADDED',
          payload: {
            item_id: itemAId,
            line_no: 1,
            sku_id: f.menuSkuId,
            uom_id: f.pcsUomId,
            sku_code: 'NASGOR-01',
            item_name: 'Nasi Goreng',
            uom_code: 'pcs',
            qty: '2',
            conversion_factor: '1',
            unit_price: 37000,
            base_unit_price: 35000,
            price_source: 'TENANT_DEFAULT',
            is_open_price: false,
            taxable: true,
            modifiers: [{ modifier_id: extraMod.id, name: 'Extra Sambal', price_delta: 2000, qty: 1 }],
          },
          created_at_device: '2026-11-24T12:01:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-24T12:01:00.000Z',
          business_date: '2026-11-24',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
      ]),
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: 'r1' },
    )
    expect(resWaiter.results[0]?.outcome).toBe('ACK')

    // 2. Cashier-2 opens Bill B so waiter also sees another device's bill (not incoming to waiter)
    const billBId = newTestId()
    const resKasir2 = await processPush(
      {
        tenantId: f.tenantId,
        deviceId: enr2.device_id,
        registerId: otherCashierReg.id,
        outletId: f.outletA,
        registerType: 'CASHIER',
      },
      pushEnvelope(newTestId(), 1, billBId, [
        {
          id: newTestId(),
          bill_id: billBId,
          bill_seq: 1,
          device_id: enr2.device_id,
          register_id: otherCashierReg.id,
          device_seq: 1,
          staff_id: f.appUserId,
          event_type: 'BILL_OPENED',
          payload: { table_id: tableA2.id, bill_ref: 'A2-0001' },
          created_at_device: '2026-11-24T12:02:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-24T12:02:00.000Z',
          business_date: '2026-11-24',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
      ]),
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: 'r2' },
    )
    expect(resKasir2.results[0]?.outcome).toBe('ACK')

    // 3. Waiter initiates handover of Bill A to Cashier-1
    const hoRes = await handleBillHandover(
      new Request('http://localhost/api/pos/v1/bills/handover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${f.waiterCredential}`,
          'X-Schema-Version': '1',
          'X-App-Version': 'v1.6.0',
          'X-Sync-Protocol': '1',
        },
        body: JSON.stringify({
          bill_id: billAId,
          event_id: newTestId(),
          target_register_id: f.cashierRegId,
          client_last_event_seq: 2,
          device_seq: 3,
          staff_id: f.appUserId,
          created_at_device: '2026-11-24T12:03:00.000Z',
          clock_offset_ms: 0,
          schema_version: 1,
          app_version: 'v1.6.0',
        }),
      }),
    )
    expect(hoRes.status).toBe(200)

    // 4. Cashier-1 pulls: sees Bill A (incoming to cashierRegId) & Bill B; no customer_phone!
    const pull1 = await handlePull(
      f.cashierDev,
      { cursor: null, cycle: null, page_size: 500, attention_ids: [] },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: 'p1' },
    )
    expect('full_resync_required' in pull1).toBe(false)
    if ('full_resync_required' in pull1) return
    expect(pull1.bills).toBeDefined()
    expect(pull1.bills).not.toBe('unchanged')
    if (!pull1.bills || pull1.bills === 'unchanged') return

    expect(pull1.bills.rows).toHaveLength(2)
    const snapA = pull1.bills.rows.find((r) => r.bill_id === billAId)!
    expect(snapA.handover_status).toBe('PENDING')
    expect(snapA.handover_target_register_id).toBe(f.cashierRegId)
    expect(snapA.customer_name).toBe('Ibu Sari')
    expect('customer_phone' in snapA).toBe(false)
    expect(snapA.items).toHaveLength(1)
    expect(snapA.items[0]!.product_id).toBe(f.menuProductId)
    expect(snapA.items[0]!.modifiers[0]!.name).toBe('Extra Sambal')

    // 5. Repeat pull with same bills_etag -> 'unchanged'
    const etag = pull1.bills.etag
    const pull2 = await handlePull(
      f.cashierDev,
      { cursor: null, cycle: null, page_size: 500, attention_ids: [], bills_etag: etag },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: 'p2' },
    )
    if ('full_resync_required' in pull2) throw new Error('unexpected resync')
    expect(pull2.bills).toBe('unchanged')

    // 6. Waiter pulls: own Bill A is NOT in waiter's snapshot; Bill B IS in waiter's snapshot
    const pullWaiter = await handlePull(
      f.waiterDev,
      { cursor: null, cycle: null, page_size: 500, attention_ids: [] },
      { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: 'p3' },
    )
    if ('full_resync_required' in pullWaiter) throw new Error('unexpected resync')
    if (!pullWaiter.bills || pullWaiter.bills === 'unchanged') throw new Error('missing bills block')
    expect(pullWaiter.bills.rows.map((r) => r.bill_id)).toEqual([billBId])

    // 7. GET /api/pos/v1/bills/{id} returns full details (including phone) for same outlet, 404 for other tenant
    const getOwn = await handleGetBillDetail(
      new Request(`http://localhost/api/pos/v1/bills/${billAId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${f.cashierCredential}`,
          'X-Schema-Version': '1',
          'X-App-Version': 'v1.6.0',
          'X-Sync-Protocol': '1',
        },
      }),
    )
    expect(getOwn.status).toBe(200)
    const detailJson = (await getOwn.json()) as { id: string; customer_phone: string | null; items: unknown[] }
    expect(detailJson.id).toBe(billAId)
    expect(detailJson.customer_phone).toBe('08123456789')
    expect(detailJson.items).toHaveLength(1)

    const getCrossTenant = await handleGetBillDetail(
      new Request(`http://localhost/api/pos/v1/bills/${billAId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secondTenant.cashierCredential}`,
          'X-Schema-Version': '1',
          'X-App-Version': 'v1.6.0',
          'X-Sync-Protocol': '1',
        },
      }),
    )
    expect(getCrossTenant.status).toBe(404)
  })
})
