import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTable } from '~/modules/fnb/public'
import { processPush } from '~/modules/sync/public'
import { dataFlag } from '~/modules/sync/server/schema'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { newTestId, setupFnbTenant } from './helpers/fnb'

describe('BILL_GANDA_MEJA flag on concurrent/offline double table bills (EC-015, Phase 56)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    await closePools()
  })

  it('flags second OPEN bill on the same table via BILL_OPENED and TABLE_SET without rejecting either', async () => {
    const f = await setupFnbTenant('bf-ganda')
    const table2 = await createTable(f.fnbActor, {
      outletId: f.outletA,
      code: 'T02',
      area: 'Indoor',
      capacity: 4,
    })

    const bill1 = newTestId()
    const bill2 = newTestId()
    const bill3 = newTestId()

    const openBill = (dev: typeof f.waiterDev, billId: string, tableId: string, ref: string, seq: number) =>
      processPush(
        dev,
        {
          sent_at_device: '2026-11-24T12:00:00.000Z',
          clock_offset_ms: 0,
          commands: [
            {
              id: newTestId(),
              type: 'AppendBillEvents',
              schema_version: 1,
              device_seq: seq,
              created_at_device: '2026-11-24T12:00:00.000Z',
              depends_on: [],
              payload: {
                bill_id: billId,
                events: [
                  {
                    id: newTestId(),
                    bill_id: billId,
                    bill_seq: 1,
                    device_id: dev.deviceId,
                    register_id: dev.registerId,
                    device_seq: seq,
                    staff_id: f.appUserId,
                    event_type: 'BILL_OPENED',
                    payload: { table_id: tableId, bill_ref: ref },
                    created_at_device: '2026-11-24T12:00:00.000Z',
                    clock_offset_ms: 0,
                    occurred_at: '2026-11-24T12:00:00.000Z',
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

    expect((await openBill(f.waiterDev, bill1, f.tableA1Id, 'T01-1', 1)).results[0]!.outcome).toBe('ACK')
    expect((await openBill(f.cashierDev, bill2, f.tableA1Id, 'T01-2', 1)).results[0]!.outcome).toBe('ACK')
    expect((await openBill(f.cashierDev, bill3, table2.id, 'T02-1', 2)).results[0]!.outcome).toBe('ACK')

    // Move bill3 onto tableA1Id via TABLE_SET -> triggers BILL_GANDA_MEJA for bill3 too
    const moveRes = await processPush(
      f.cashierDev,
      {
        sent_at_device: '2026-11-24T12:05:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: newTestId(),
            type: 'AppendBillEvents',
            schema_version: 1,
            device_seq: 3,
            created_at_device: '2026-11-24T12:05:00.000Z',
            depends_on: [],
            payload: {
              bill_id: bill3,
              events: [
                {
                  id: newTestId(),
                  bill_id: bill3,
                  bill_seq: 2,
                  device_id: f.cashierDev.deviceId,
                  register_id: f.cashierDev.registerId,
                  device_seq: 3,
                  staff_id: f.appUserId,
                  event_type: 'TABLE_SET',
                  payload: { table_id: f.tableA1Id },
                  created_at_device: '2026-11-24T12:05:00.000Z',
                  clock_offset_ms: 0,
                  occurred_at: '2026-11-24T12:05:00.000Z',
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
    expect(moveRes.results[0]!.outcome).toBe('ACK')

    await withTenant(f.tenantId, async (tx) => {
      const flags = await tx
        .select()
        .from(dataFlag)
        .where(eq(dataFlag.flagCode, 'BILL_GANDA_MEJA'))
      const flaggedBills = new Set(flags.map((fl) => fl.entityId))
      expect(flaggedBills.has(bill1)).toBe(false)
      expect(flaggedBills.has(bill2)).toBe(true)
      expect(flaggedBills.has(bill3)).toBe(true)
    })
  })
})
