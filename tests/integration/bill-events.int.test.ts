import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { createModifier, createModifierGroup } from '~/modules/catalog/public'
import {
  bill,
  billEvent,
  billItem,
  billItemModifier,
} from '~/modules/fnb/public'
import { foldBillEvents as foldPure, type BillEventEnvelopeV1 } from '~/modules/fnb/shared'
import type { PushResultItem } from '~/lib/contracts'
import { processPush, type SyncDeviceIdentity } from '~/modules/sync/public'
import { dataFlag } from '~/modules/sync/server/schema'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { newTestId, setupFnbTenant } from './helpers/fnb'

function buildEvent(
  f: { appUserId: string },
  dev: SyncDeviceIdentity,
  billId: string,
  billSeq: number,
  deviceSeq: number,
  eventType: BillEventEnvelopeV1['event_type'],
  payload: Record<string, unknown>,
  extra?: Partial<BillEventEnvelopeV1>,
): BillEventEnvelopeV1 {
  const ts = `2026-11-24T12:${String(billSeq).padStart(2, '0')}:00.000Z`
  return {
    id: newTestId(),
    bill_id: billId,
    bill_seq: billSeq,
    device_id: dev.deviceId,
    register_id: dev.registerId,
    device_seq: deviceSeq,
    staff_id: f.appUserId,
    event_type: eventType,
    payload,
    created_at_device: ts,
    clock_offset_ms: 0,
    occurred_at: ts,
    business_date: '2026-11-24',
    schema_version: 1,
    app_version: 'v1.6.0',
    ...extra,
  }
}

async function pushAppend(
  dev: SyncDeviceIdentity,
  billId: string,
  events: BillEventEnvelopeV1[],
  deviceSeq: number,
  cmdId = newTestId(),
) {
  return processPush(
    dev,
    {
      sent_at_device: '2026-11-24T12:00:00.000Z',
      clock_offset_ms: 0,
      commands: [
        {
          id: cmdId,
          type: 'AppendBillEvents',
          schema_version: 1,
          device_seq: deviceSeq,
          created_at_device: '2026-11-24T12:00:00.000Z',
          depends_on: [],
          payload: { bill_id: billId, events },
        },
      ],
    },
    { schemaVersion: 1, appVersion: 'v1.6.0', syncProtocol: 1, requestRef: `req-${newTestId()}` },
  )
}

describe('AppendBillEvents DB integration (Phase 56)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    await closePools()
  })

  it('persists full bill lifecycle matching foldBillEvents, supports split batches, and is 5x idempotent', async () => {
    const f = await setupFnbTenant('be-full')
    const grp = await createModifierGroup(f.catalogActor, {
      name: 'Extras',
      selectionType: 'MULTI',
      minSelect: 0,
      maxSelect: 3,
      isActive: true,
    })
    const mod = await createModifier(f.catalogActor, {
      modifierGroupId: grp.id,
      name: 'Extra Telur',
      priceDelta: 5000,
      isActive: true,
      sortOrder: 1,
    })

    const billId = newTestId()
    const item1 = newTestId()
    const item2 = newTestId()
    const item3 = newTestId()

    const batch1: BillEventEnvelopeV1[] = [
      buildEvent(f, f.waiterDev, billId, 1, 1, 'BILL_OPENED', {
        table_id: f.tableA1Id,
        bill_ref: 'M05-0001',
      }),
      buildEvent(f, f.waiterDev, billId, 2, 2, 'ITEM_ADDED', {
        item_id: item1,
        line_no: 1,
        sku_id: f.menuSkuId,
        uom_id: f.pcsUomId,
        sku_code: 'NASGOR-01',
        item_name: 'Nasi Goreng',
        uom_code: 'pcs',
        qty: '2',
        conversion_factor: '1',
        unit_price: 40000,
        base_unit_price: 35000,
        price_source: 'TENANT_DEFAULT',
        is_open_price: false,
        taxable: true,
        modifiers: [{ modifier_id: mod.id, name: 'Extra Telur', price_delta: 5000, qty: 1 }],
      }),
      buildEvent(f, f.waiterDev, billId, 3, 3, 'ITEM_ADDED', {
        item_id: item2,
        line_no: 2,
        sku_id: f.menu2SkuId,
        uom_id: f.pcsUomId,
        sku_code: 'AYAMBK-01',
        item_name: 'Ayam Bakar',
        uom_code: 'pcs',
        qty: '1',
        conversion_factor: '1',
        unit_price: 45000,
        price_source: 'TENANT_DEFAULT',
        is_open_price: false,
        taxable: true,
        modifiers: [],
      }),
      buildEvent(f, f.waiterDev, billId, 4, 4, 'ITEM_ADDED', {
        item_id: item3,
        line_no: 3,
        sku_id: f.menu2SkuId,
        uom_id: f.pcsUomId,
        sku_code: 'AYAMBK-01',
        item_name: 'Ayam Bakar',
        uom_code: 'pcs',
        qty: '1',
        conversion_factor: '1',
        unit_price: 45000,
        price_source: 'TENANT_DEFAULT',
        is_open_price: false,
        taxable: true,
        modifiers: [],
      }),
    ]

    const cmd1Id = newTestId()
    for (let i = 0; i < 5; i += 1) {
      const res = await pushAppend(f.waiterDev, billId, batch1, 100, cmd1Id)
      expect(res.results[0]!.outcome).toBe('ACK')
    }

    const batch2: BillEventEnvelopeV1[] = [
      buildEvent(
        f,
        f.waiterDev,
        billId,
        5,
        5,
        'ITEM_VOIDED',
        { item_id: item3 },
        { reason_code: 'CANCEL', reason_text: 'Batal tamu' },
      ),
      buildEvent(f, f.waiterDev, billId, 6, 6, 'ITEM_QTY_CHANGED', { item_id: item1, qty: '3' }),
      buildEvent(f, f.waiterDev, billId, 7, 7, 'PREBILL_PRINTED', {}),
      buildEvent(f, f.waiterDev, billId, 8, 8, 'DISCOUNT_SET', {
        type: 'PERCENT',
        pct: '10.0000',
      }),
      buildEvent(f, f.waiterDev, billId, 9, 9, 'CUSTOMER_SET', {
        name: 'Tamu VIP',
        phone: '081111',
      }),
    ]

    const res2 = await pushAppend(f.waiterDev, billId, batch2, 101)
    const r2 = res2.results[0]! as Extract<PushResultItem, { outcome: 'ACK' }>
    expect(r2.outcome).toBe('ACK')
    expect(r2.result).toMatchObject({
      bill_id: billId,
      last_event_seq: 9,
      applied: 5,
      skipped: 0,
    })

    // Replay same events under a new command_id (V-37 style retry) -> skipped cleanly
    const resReplay = await pushAppend(f.waiterDev, billId, batch2, 102)
    const rRep = resReplay.results[0]! as Extract<PushResultItem, { outcome: 'ACK' }>
    expect(rRep.outcome).toBe('ACK')
    expect(rRep.result).toMatchObject({ applied: 0, skipped: 5 })

    const expectedFold = foldPure(billId, [...batch1, ...batch2])

    await withTenant(f.tenantId, async (tx) => {
      const [b] = await tx.select().from(bill).where(and(eq(bill.tenantId, f.tenantId), eq(bill.id, billId)))
      expect(b).toBeDefined()
      expect(b!.lastEventSeq).toBe(expectedFold.lastEventSeq)
      expect(b!.lastContentSeq).toBe(expectedFold.lastContentSeq)
      expect(b!.prebillSeq).toBe(expectedFold.prebillSeq)
      expect(b!.isAwaitingPayment).toBe(true)
      expect(b!.billDiscountType).toBe('PERCENT')
      expect(b!.customerName).toBe('Tamu VIP')

      const evRows = await tx.select().from(billEvent).where(eq(billEvent.billId, billId))
      expect(evRows).toHaveLength(9)

      const itemRows = await tx.select().from(billItem).where(eq(billItem.billId, billId))
      expect(itemRows).toHaveLength(3)
      expect(itemRows.find((x) => x.id === item1)?.qty).toBe('3.0000')
      expect(itemRows.find((x) => x.id === item3)?.status).toBe('VOIDED')
      expect(itemRows.find((x) => x.id === item3)?.voidReasonText).toBe('Batal tamu')

      const modRows = await tx.select().from(billItemModifier).where(eq(billItemModifier.billItemId, item1))
      expect(modRows).toHaveLength(1)
      expect(modRows[0]!.modifierId).toBe(mod.id)
    })
  })

  it('rejects non-lease-holder, PAID bill, seq gap, and flags SELISIH_HITUNG on modifier price discrepancy', async () => {
    const f = await setupFnbTenant('be-guards')
    const fOther = await setupFnbTenant('be-other')
    const billId = newTestId()
    const itemId = newTestId()

    await pushAppend(
      f.waiterDev,
      billId,
      [
        buildEvent(f, f.waiterDev, billId, 1, 1, 'BILL_OPENED', {
          table_id: f.tableA1Id,
          bill_ref: 'M01-0001',
        }),
        buildEvent(f, f.waiterDev, billId, 2, 2, 'ITEM_ADDED', {
          item_id: itemId,
          line_no: 1,
          sku_id: f.menuSkuId,
          uom_id: f.pcsUomId,
          sku_code: 'NASGOR-01',
          item_name: 'Nasi Goreng',
          uom_code: 'pcs',
          qty: '1',
          conversion_factor: '1',
          unit_price: 99000,
          base_unit_price: 35000,
          price_source: 'TENANT_DEFAULT',
          is_open_price: false,
          taxable: true,
          modifiers: [],
        }),
      ],
      10,
    )

    // Non-holder cashier device -> ATTENTION NOT_LEASE_HOLDER, no events written
    const nonHolder = await pushAppend(
      f.cashierDev,
      billId,
      [buildEvent(f, f.cashierDev, billId, 3, 1, 'PREBILL_PRINTED', {})],
      10,
    )
    expect(nonHolder.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'AUTHORIZATION',
      reason_code: 'NOT_LEASE_HOLDER',
    })

    // Sequence gap (seq 4 instead of 3) -> ATTENTION BILL_SEQ_GAP
    const gapRes = await pushAppend(
      f.waiterDev,
      billId,
      [buildEvent(f, f.waiterDev, billId, 4, 3, 'PREBILL_PRINTED', {})],
      11,
    )
    expect(gapRes.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'BILL_SEQ_GAP',
    })

    // Cross-tenant isolation: tenant B device cannot access tenant A bill
    const crossTenant = await pushAppend(
      fOther.waiterDev,
      billId,
      [buildEvent(fOther, fOther.waiterDev, billId, 3, 1, 'PREBILL_PRINTED', {})],
      1,
    )
    expect(crossTenant.results[0]!.outcome).toBe('ATTENTION')

    // Mark bill PAID, then try appending -> ATTENTION BILL_CLOSED
    await withTenant(f.tenantId, async (tx) => {
      await tx.update(bill).set({ status: 'PAID' }).where(eq(bill.id, billId))
    })
    const paidRes = await pushAppend(
      f.waiterDev,
      billId,
      [buildEvent(f, f.waiterDev, billId, 3, 4, 'PREBILL_PRINTED', {})],
      12,
    )
    expect(paidRes.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'BILL_CLOSED',
    })

    // Check SELISIH_HITUNG flag and exact event count (still 2)
    await withTenant(f.tenantId, async (tx) => {
      const evs = await tx.select().from(billEvent).where(eq(billEvent.billId, billId))
      expect(evs).toHaveLength(2)
      const flags = await tx.select().from(dataFlag).where(eq(dataFlag.entityId, billId))
      expect(flags.map((fl) => fl.flagCode)).toContain('SELISIH_HITUNG')
    })
  })
})
