import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { BillEventEnvelopeV1 } from './bill-events'
import {
  applyBillEvent,
  BillProjectionError,
  emptyBill,
  foldBillEvents,
  isAwaitingPayment,
  mergeSimilarItems,
  type BillProjectionItem,
} from './bill-projection'

const BILL_ID = '01950000-0000-7000-8000-000000000101'
const DEV_W = '01950000-0000-7000-8000-000000000201'
const DEV_C = '01950000-0000-7000-8000-000000000202'
const REG_W = '01950000-0000-7000-8000-000000000301'
const REG_C = '01950000-0000-7000-8000-000000000302'
const STAFF_ID = '01950000-0000-7000-8000-000000000401'
const TABLE_1 = '01950000-0000-7000-8000-000000000501'
const SKU_NG = '01950000-0000-7000-8000-000000000701'
const SKU_ET = '01950000-0000-7000-8000-000000000702'
const UOM_ID = '01950000-0000-7000-8000-000000000801'
const ITEM_1 = '01950000-0000-7000-8000-000000000601'
const ITEM_2 = '01950000-0000-7000-8000-000000000602'
const MOD_1 = '01950000-0000-7000-8000-000000000901'

function ev(
  seq: number,
  eventType: BillEventEnvelopeV1['event_type'],
  payload: Record<string, unknown>,
  extra?: Partial<BillEventEnvelopeV1>,
): BillEventEnvelopeV1 {
  const hex = seq.toString(16).padStart(12, '0')
  return {
    id: `01950000-0000-7000-8000-${hex}`,
    bill_id: BILL_ID,
    bill_seq: seq,
    device_id: DEV_W,
    register_id: REG_W,
    device_seq: seq,
    staff_id: STAFF_ID,
    event_type: eventType,
    payload,
    created_at_device: `2026-11-24T12:${String(seq).padStart(2, '0')}:00.000Z`,
    clock_offset_ms: 0,
    occurred_at: `2026-11-24T12:${String(seq).padStart(2, '0')}:00.000Z`,
    business_date: '2026-11-24',
    schema_version: 1,
    app_version: 'v1.6.0',
    ...extra,
  }
}

describe('fnb/shared/bill-projection (BR-FNB-005/008/010/012)', () => {
  it('models BR-FNB-010 awaiting payment lifecycle (19:42 prebill -> 19:45 add item -> 19:46 reprint)', () => {
    let state = emptyBill(BILL_ID)
    state = applyBillEvent(state, ev(1, 'BILL_OPENED', { table_id: TABLE_1, bill_ref: 'M05-0003' }))
    state = applyBillEvent(
      state,
      ev(2, 'ITEM_ADDED', {
        item_id: ITEM_1,
        line_no: 1,
        sku_id: SKU_NG,
        uom_id: UOM_ID,
        sku_code: 'NASGOR',
        item_name: 'Nasi Goreng',
        uom_code: 'pcs',
        qty: '2',
        conversion_factor: '1',
        unit_price: 35000,
        price_source: 'TENANT_DEFAULT',
        is_open_price: false,
        taxable: true,
        modifiers: [],
      }),
    )
    expect(isAwaitingPayment(state)).toBe(false)

    // 19:42 prebill printed -> awaiting payment
    state = applyBillEvent(
      state,
      ev(3, 'PREBILL_PRINTED', {}, { occurred_at: '2026-11-24T12:42:00.000Z' }),
    )
    expect(isAwaitingPayment(state)).toBe(true)
    expect(state.prebillSeq).toBe(3)

    // 19:45 add Es Teh -> back to occupied (not awaiting payment)
    state = applyBillEvent(
      state,
      ev(
        4,
        'ITEM_ADDED',
        {
          item_id: ITEM_2,
          line_no: 2,
          sku_id: SKU_ET,
          uom_id: UOM_ID,
          sku_code: 'ESTEH',
          item_name: 'Es Teh',
          uom_code: 'pcs',
          qty: '1',
          conversion_factor: '1',
          unit_price: 8000,
          price_source: 'TENANT_DEFAULT',
          is_open_price: false,
          taxable: true,
          modifiers: [],
        },
        { occurred_at: '2026-11-24T12:45:00.000Z' },
      ),
    )
    expect(isAwaitingPayment(state)).toBe(false)
    expect(state.lastContentSeq).toBe(4)

    // 19:46 reprint -> awaiting payment again
    state = applyBillEvent(
      state,
      ev(5, 'PREBILL_PRINTED', {}, { occurred_at: '2026-11-24T12:46:00.000Z' }),
    )
    expect(isAwaitingPayment(state)).toBe(true)

    // Idempotent replay of event id 5 is a no-op
    const replayed = applyBillEvent(
      state,
      ev(5, 'PREBILL_PRINTED', {}, { occurred_at: '2026-11-24T12:46:00.000Z' }),
    )
    expect(replayed).toBe(state)
  })

  it('retains voided items, rejects BILL_CANCELED with active items, and supports cancel after voiding all items', () => {
    const events: BillEventEnvelopeV1[] = [
      ev(1, 'BILL_OPENED', { table_id: TABLE_1, bill_ref: 'M05-0004' }),
      ev(2, 'ITEM_ADDED', {
        item_id: ITEM_1,
        line_no: 1,
        sku_id: SKU_NG,
        uom_id: UOM_ID,
        sku_code: 'NASGOR',
        item_name: 'Nasi Goreng',
        uom_code: 'pcs',
        qty: '1',
        conversion_factor: '1',
        unit_price: 35000,
        price_source: 'TENANT_DEFAULT',
        is_open_price: false,
        taxable: true,
        modifiers: [{ modifier_id: MOD_1, name: 'Extra Telur', price_delta: 5000, qty: 1 }],
      }),
    ]

    const openWithActive = foldBillEvents(BILL_ID, events)
    expect(() =>
      applyBillEvent(openWithActive, ev(3, 'BILL_CANCELED', {})),
    ).toThrow(BillProjectionError)

    const voided = applyBillEvent(
      openWithActive,
      ev(3, 'ITEM_VOIDED', { item_id: ITEM_1 }, { reason_code: 'WRONG', reason_text: 'Salah input' }),
    )
    expect(voided.items.get(ITEM_1)?.status).toBe('VOIDED')
    expect(voided.items.get(ITEM_1)?.voidReasonText).toBe('Salah input')

    const canceled = applyBillEvent(voided, ev(4, 'BILL_CANCELED', {}))
    expect(canceled.status).toBe('CANCELED')

    expect(() =>
      applyBillEvent(canceled, ev(5, 'PREBILL_PRINTED', {})),
    ).toThrow(BillProjectionError)
  })

  it('tracks handover and lease transfer cleanly', () => {
    const e1 = ev(1, 'BILL_OPENED', { table_id: TABLE_1, bill_ref: 'M05-0005' })
    const e2 = ev(2, 'BILL_HANDED_OVER', { target_register_id: REG_C }, { target_register_id: REG_C })
    const e3 = ev(3, 'BILL_ACCEPTED', { handover_event_id: e2.id }, {
      device_id: DEV_C,
      register_id: REG_C,
      handover_event_id: e2.id,
    })
    const state = foldBillEvents(BILL_ID, [e3, e1, e2])
    expect(state.leaseDeviceId).toBe(DEV_C)
    expect(state.leaseRegisterId).toBe(REG_C)
    expect(state.handoverStatus).toBe('NONE')
    expect(state.lastEventSeq).toBe(3)
  })

  it('property: foldBillEvents produces identical projection regardless of arrival permutation or duplicates', () => {
    const baseEvents: BillEventEnvelopeV1[] = [
      ev(1, 'BILL_OPENED', { table_id: TABLE_1, bill_ref: 'M01-0001' }),
      ev(2, 'ITEM_ADDED', {
        item_id: ITEM_1,
        line_no: 1,
        sku_id: SKU_NG,
        uom_id: UOM_ID,
        sku_code: 'NASGOR',
        item_name: 'Nasi Goreng',
        uom_code: 'pcs',
        qty: '2',
        conversion_factor: '1',
        unit_price: 35000,
        price_source: 'TENANT_DEFAULT',
        is_open_price: false,
        taxable: true,
        modifiers: [],
      }),
      ev(3, 'ITEM_QTY_CHANGED', { item_id: ITEM_1, qty: '3' }),
      ev(4, 'MODIFIER_SET', {
        item_id: ITEM_1,
        modifiers: [{ modifier_id: MOD_1, name: 'Extra Telur', price_delta: 5000, qty: 1 }],
        unit_price: 40000,
      }),
      ev(5, 'PREBILL_PRINTED', {}),
      ev(6, 'DISCOUNT_SET', { type: 'NOMINAL', input: 5000 }),
      ev(7, 'CUSTOMER_SET', { name: 'Budi', phone: '081234' }),
    ]

    const canonical = foldBillEvents(BILL_ID, baseEvents)

    fc.assert(
      fc.property(
        fc.shuffledSubarray(baseEvents, { minLength: baseEvents.length, maxLength: baseEvents.length }),
        fc.nat({ max: baseEvents.length - 1 }),
        (shuffled, dupIdx) => {
          const withDup = [...shuffled, shuffled[dupIdx]!]
          const folded = foldBillEvents(BILL_ID, withDup)
          expect(folded).toEqual(canonical)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('mergeSimilarItems folds identical SKU+price+modifiers+discount and keeps distinct lines separate', () => {
    const baseItem = (over: Partial<BillProjectionItem>): BillProjectionItem => ({
      id: 'i-base',
      lineNo: 1,
      skuId: SKU_NG,
      uomId: UOM_ID,
      skuCode: 'NASGOR',
      itemName: 'Nasi Goreng',
      uomCode: 'pcs',
      qty: '1',
      conversionFactor: '1',
      unitPrice: 40000,
      priceSource: 'TENANT_DEFAULT',
      isOpenPrice: false,
      taxable: true,
      discountType: null,
      discountPct: null,
      discountInput: null,
      discountApprovedBy: null,
      note: null,
      status: 'ACTIVE',
      voidReasonCode: null,
      voidReasonText: null,
      createdEventId: 'e-1',
      modifiers: [{ modifierId: MOD_1, name: 'Extra Telur', priceDelta: 5000, qty: 1 }],
      ...over,
    })

    const target = [baseItem({ id: 't1', lineNo: 1, qty: '2' })]
    const incoming = [
      {
        originBillId: 'b-src',
        originItemId: 's1',
        newItemId: 'n1',
        item: baseItem({ id: 's1', lineNo: 1, qty: '1' }),
      },
      {
        originBillId: 'b-src',
        originItemId: 's2',
        newItemId: 'n2',
        item: baseItem({ id: 's2', lineNo: 2, qty: '1', note: 'Pedas' }),
      },
    ]

    const res = mergeSimilarItems(target, incoming)
    expect(res.updatedExisting).toEqual([{ id: 't1', nextQty: '3' }])
    expect(res.insertedNew).toHaveLength(1)
    expect(res.insertedNew[0]?.id).toBe('n2')
    expect(res.insertedNew[0]?.lineNo).toBe(2)
  })
})
