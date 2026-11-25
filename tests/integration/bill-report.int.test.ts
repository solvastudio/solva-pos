import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { BillEventEnvelopeV1 } from '~/modules/fnb/shared'
import { revokeDevice } from '~/modules/identity/public'
import { exportReportCsv, getOpsReport } from '~/modules/reporting/public'
import { processPush } from '~/modules/sync/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { newTestId, setupFnbTenant } from './helpers/fnb'

const META = (requestRef: string) => ({
  schemaVersion: 1,
  appVersion: 'v1.6.0',
  syncProtocol: 1,
  requestRef,
})

function billPush(cmdId: string, deviceSeq: number, billId: string, events: BillEventEnvelopeV1[]) {
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

describe('integration: R-04 orphan bills (RSK-04) & BILL_GANDA_MEJA report', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('detects revoked-device orphan bill (RSK-04), stale >24h open bill, and duplicate table bills while exporting CSV', async () => {
    const f = await setupFnbTenant('r04-bills')
    const ts = '2026-11-25T10:00:00.000Z'

    // 1. Waiter opens a bill on Table A1 (with 1 item) and then device gets revoked (RSK-04)
    const billWaiter = newTestId()
    const pushW = await processPush(
      f.waiterDev,
      billPush(newTestId(), 1, billWaiter, [
        {
          id: newTestId(),
          bill_id: billWaiter,
          bill_seq: 1,
          device_id: f.waiterDev.deviceId,
          register_id: f.waiterRegId,
          device_seq: 1,
          staff_id: f.appUserId,
          event_type: 'BILL_OPENED',
          payload: { table_id: f.tableA1Id, bill_ref: 'T01-ORPHAN' },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
        {
          id: newTestId(),
          bill_id: billWaiter,
          bill_seq: 2,
          device_id: f.waiterDev.deviceId,
          register_id: f.waiterRegId,
          device_seq: 2,
          staff_id: f.appUserId,
          event_type: 'ITEM_ADDED',
          payload: {
            item_id: newTestId(),
            line_no: 1,
            sku_id: f.menuSkuId,
            uom_id: f.pcsUomId,
            sku_code: 'NASGOR-01',
            item_name: 'Nasi Goreng',
            uom_code: 'pcs',
            qty: '2',
            conversion_factor: '1',
            unit_price: 35000,
            price_source: 'TENANT_DEFAULT',
            is_open_price: false,
            taxable: true,
            modifiers: [],
          },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
      ]),
      META('req-r04-w'),
    )
    expect(pushW.results[0]?.outcome).toBe('ACK')

    // 2. Cashier opens a second independent OPEN bill on the SAME Table A1 -> triggers BILL_GANDA_MEJA
    const billCashier = newTestId()
    const pushC = await processPush(
      f.cashierDev,
      billPush(newTestId(), 1, billCashier, [
        {
          id: newTestId(),
          bill_id: billCashier,
          bill_seq: 1,
          device_id: f.cashierDev.deviceId,
          register_id: f.cashierRegId,
          device_seq: 1,
          staff_id: f.appUserId,
          event_type: 'BILL_OPENED',
          payload: { table_id: f.tableA1Id, bill_ref: 'T01-DUP2' },
          created_at_device: ts,
          clock_offset_ms: 0,
          occurred_at: ts,
          business_date: '2026-11-25',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
      ]),
      META('req-r04-c'),
    )
    expect(pushC.results[0]?.outcome).toBe('ACK')

    // Age the cashier bill back 30 hours so it also triggers stale >24h orphan detection.
    await withTenant(f.tenantId, async (tx) => {
      await tx.execute(
        sql`UPDATE bill SET last_event_at = now() - interval '30 hours' WHERE tenant_id = ${f.tenantId}::uuid AND id = ${billCashier}::uuid`,
      )
    })

    // Revoke waiter device (lost phone RSK-04)
    await revokeDevice(f.actor, {
      deviceId: f.waiterDev.deviceId,
      reasonCode: 'LOST',
    })

    const rpt = await getOpsReport(
      {
        tenantId: f.tenantId,
        appUserId: f.appUserId,
        permissions: new Set(['report.view']),
        outletIds: [f.outletA],
      },
      {
        outletIds: [f.outletA],
        from: '2026-11-24',
        to: '2026-11-26',
        groupBy: 'DAY',
      },
    )

    expect(rpt.sections.orphanBills.length).toBeGreaterThanOrEqual(2)
    const waiterOrphan = rpt.sections.orphanBills.find((b) => b.billId === billWaiter)
    expect(waiterOrphan?.deviceRevokedAt).not.toBeNull()
    expect(waiterOrphan?.estimatedTotal).toBe(70000)

    const staleOrphan = rpt.sections.orphanBills.find((b) => b.billId === billCashier)
    expect(staleOrphan?.deviceRevokedAt).toBeNull()
    expect(staleOrphan?.ageHours).toBeGreaterThanOrEqual(29)

    expect(rpt.sections.duplicateBills.length).toBeGreaterThanOrEqual(1)
    expect(rpt.sections.duplicateBills[0]?.tableCode).toBe('T01')

    const csvRes = await exportReportCsv(
      {
        tenantId: f.tenantId,
        appUserId: f.appUserId,
        permissions: new Set(['report.view']),
        outletIds: [f.outletA],
      },
      'operations',
      {
        outletIds: [f.outletA],
        from: '2026-11-24',
        to: '2026-11-26',
        groupBy: 'DAY',
      },
    )
    expect(csvRes.csv).toContain('ORPHAN_BILL')
    expect(csvRes.csv).toContain('BILL_GANDA_MEJA')
  })
})
