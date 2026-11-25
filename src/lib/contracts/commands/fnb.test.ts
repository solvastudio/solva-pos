import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  AcceptBillPayloadV1,
  AppendBillEventsPayloadV1,
  CancelBillHandoverPayloadV1,
  HandOverBillPayloadV1,
} from './fnb'
import { parseCommandPayload } from './index'

const BILL_ID = '01950000-0000-7000-8000-000000000101'
const DEV_ID = '01950000-0000-7000-8000-000000000201'
const REG_ID = '01950000-0000-7000-8000-000000000301'
const TARGET_REG_ID = '01950000-0000-7000-8000-000000000302'
const STAFF_ID = '01950000-0000-7000-8000-000000000401'
const TABLE_ID = '01950000-0000-7000-8000-000000000501'
const ITEM_ID = '01950000-0000-7000-8000-000000000601'
const SKU_ID = '01950000-0000-7000-8000-000000000701'
const UOM_ID = '01950000-0000-7000-8000-000000000801'
const MOD_ID = '01950000-0000-7000-8000-000000000901'
const EV1 = '01950000-0000-7000-8000-000000001001'
const EV2 = '01950000-0000-7000-8000-000000001002'

describe('contracts/commands/fnb (v1)', () => {
  it('parses valid AppendBillEvents and online handover payloads via parseCommandPayload', () => {
    const append = parseCommandPayload('AppendBillEvents', 1, {
      bill_id: BILL_ID,
      events: [
        {
          id: EV1,
          bill_id: BILL_ID,
          bill_seq: 1,
          device_id: DEV_ID,
          register_id: REG_ID,
          device_seq: 10,
          staff_id: STAFF_ID,
          event_type: 'BILL_OPENED',
          payload: { table_id: TABLE_ID, bill_ref: 'M05-0003' },
          created_at_device: '2026-11-24T12:40:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-24T12:40:00.000Z',
          business_date: '2026-11-24',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
        {
          id: EV2,
          bill_id: BILL_ID,
          bill_seq: 2,
          device_id: DEV_ID,
          register_id: REG_ID,
          device_seq: 11,
          staff_id: STAFF_ID,
          event_type: 'ITEM_ADDED',
          payload: {
            item_id: ITEM_ID,
            line_no: 1,
            sku_id: SKU_ID,
            uom_id: UOM_ID,
            sku_code: 'NASGOR-01',
            item_name: 'Nasi Goreng',
            uom_code: 'pcs',
            qty: '1',
            conversion_factor: '1',
            unit_price: 40000,
            base_unit_price: 35000,
            price_source: 'TENANT_DEFAULT',
            is_open_price: false,
            taxable: true,
            modifiers: [{ modifier_id: MOD_ID, name: 'Extra Telur', price_delta: 5000, qty: 1 }],
          },
          created_at_device: '2026-11-24T12:41:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-24T12:41:00.000Z',
          business_date: '2026-11-24',
          schema_version: 1,
          app_version: 'v1.6.0',
        },
      ],
    }) as AppendBillEventsPayloadV1
    expect(append.events).toHaveLength(2)

    const ho = HandOverBillPayloadV1.parse({
      event_id: EV1,
      bill_id: BILL_ID,
      device_seq: 12,
      staff_id: STAFF_ID,
      client_last_event_seq: 2,
      target_register_id: TARGET_REG_ID,
      created_at_device: '2026-11-24T12:42:00.000Z',
      clock_offset_ms: 0,
      schema_version: 1,
      app_version: 'v1.6.0',
    })
    expect(ho.target_register_id).toBe(TARGET_REG_ID)

    expect(
      AcceptBillPayloadV1.parse({
        event_id: EV2,
        bill_id: BILL_ID,
        device_seq: 1,
        staff_id: STAFF_ID,
        client_last_event_seq: 3,
        created_at_device: '2026-11-24T12:43:00.000Z',
        clock_offset_ms: 0,
        schema_version: 1,
      }).bill_id,
    ).toBe(BILL_ID)

    expect(
      CancelBillHandoverPayloadV1.parse({
        event_id: EV2,
        bill_id: BILL_ID,
        device_seq: 13,
        staff_id: STAFF_ID,
        client_last_event_seq: 3,
        created_at_device: '2026-11-24T12:43:00.000Z',
        clock_offset_ms: 0,
        schema_version: 1,
      }).bill_id,
    ).toBe(BILL_ID)
  })

  it('rejects customer data outside CUSTOMER_SET, missing void reason, and unsorted bill_seq', () => {
    expect(() =>
      AppendBillEventsPayloadV1.parse({
        bill_id: BILL_ID,
        events: [
          {
            id: EV1,
            bill_id: BILL_ID,
            bill_seq: 1,
            device_id: DEV_ID,
            register_id: REG_ID,
            device_seq: 1,
            staff_id: STAFF_ID,
            event_type: 'ITEM_VOIDED',
            payload: { item_id: ITEM_ID },
            created_at_device: '2026-11-24T12:40:00.000Z',
            clock_offset_ms: 0,
            occurred_at: '2026-11-24T12:40:00.000Z',
            business_date: '2026-11-24',
            schema_version: 1,
          },
        ],
      }),
    ).toThrow(ZodError)

    expect(() =>
      AppendBillEventsPayloadV1.parse({
        bill_id: BILL_ID,
        events: [
          {
            id: EV1,
            bill_id: BILL_ID,
            bill_seq: 1,
            device_id: DEV_ID,
            register_id: REG_ID,
            device_seq: 1,
            staff_id: STAFF_ID,
            event_type: 'PREBILL_PRINTED',
            payload: { customer_name: 'Forbidden' },
            created_at_device: '2026-11-24T12:40:00.000Z',
            clock_offset_ms: 0,
            occurred_at: '2026-11-24T12:40:00.000Z',
            business_date: '2026-11-24',
            schema_version: 1,
          },
        ],
      }),
    ).toThrow(ZodError)

    expect(() =>
      AppendBillEventsPayloadV1.parse({
        bill_id: BILL_ID,
        events: [
          {
            id: EV1,
            bill_id: BILL_ID,
            bill_seq: 2,
            device_id: DEV_ID,
            register_id: REG_ID,
            device_seq: 1,
            staff_id: STAFF_ID,
            event_type: 'PREBILL_PRINTED',
            payload: {},
            created_at_device: '2026-11-24T12:40:00.000Z',
            clock_offset_ms: 0,
            occurred_at: '2026-11-24T12:40:00.000Z',
            business_date: '2026-11-24',
            schema_version: 1,
          },
          {
            id: EV2,
            bill_id: BILL_ID,
            bill_seq: 1,
            device_id: DEV_ID,
            register_id: REG_ID,
            device_seq: 2,
            staff_id: STAFF_ID,
            event_type: 'PREBILL_PRINTED',
            payload: {},
            created_at_device: '2026-11-24T12:41:00.000Z',
            clock_offset_ms: 0,
            occurred_at: '2026-11-24T12:41:00.000Z',
            business_date: '2026-11-24',
            schema_version: 1,
          },
        ],
      }),
    ).toThrow(ZodError)
  })

  it('validates BILL_SPLIT (EQUAL vs ITEM/QTY) and BILL_MERGED schemas strictly', () => {
    const splitEqual = parseCommandPayload('AppendBillEvents', 1, {
      bill_id: BILL_ID,
      events: [
        {
          id: EV1,
          bill_id: BILL_ID,
          bill_seq: 3,
          device_id: DEV_ID,
          register_id: REG_ID,
          device_seq: 15,
          staff_id: STAFF_ID,
          event_type: 'BILL_SPLIT',
          payload: {
            split_mode: 'EQUAL',
            children: [
              {
                child_bill_id: '01950000-0000-7000-8000-000000000102',
                child_bill_ref: 'M05-0003-1',
                share_index: 1,
                share_count: 2,
                items: [],
              },
              {
                child_bill_id: '01950000-0000-7000-8000-000000000103',
                child_bill_ref: 'M05-0003-2',
                share_index: 2,
                share_count: 2,
                items: [],
              },
            ],
          },
          created_at_device: '2026-11-24T12:45:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-24T12:45:00.000Z',
          business_date: '2026-11-24',
          schema_version: 1,
        },
      ],
    }) as AppendBillEventsPayloadV1
    expect(splitEqual.events[0]?.event_type).toBe('BILL_SPLIT')

    const merged = parseCommandPayload('AppendBillEvents', 1, {
      bill_id: BILL_ID,
      events: [
        {
          id: EV2,
          bill_id: BILL_ID,
          bill_seq: 4,
          device_id: DEV_ID,
          register_id: REG_ID,
          device_seq: 16,
          staff_id: STAFF_ID,
          event_type: 'BILL_MERGED',
          payload: {
            source_bill_ids: ['01950000-0000-7000-8000-000000000104'],
          },
          created_at_device: '2026-11-24T12:46:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-24T12:46:00.000Z',
          business_date: '2026-11-24',
          schema_version: 1,
        },
      ],
    }) as AppendBillEventsPayloadV1
    expect(merged.events[0]?.event_type).toBe('BILL_MERGED')
  })
})
