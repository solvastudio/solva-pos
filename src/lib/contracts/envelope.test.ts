import { describe, expect, it } from 'vitest'
import { ErrorEnvelope, PingResponse, PushRequest, PushResponse } from './envelope'

const SAMPLE_UUID = '019a0000-0000-7000-8000-000000000001'
const SAMPLE_ISO = '2026-11-19T14:05:00.000Z'

describe('contracts/envelope (Zod 4)', () => {
  it('menerima PushRequest, PushResponse, PingResponse, dan ErrorEnvelope yang sah', () => {
    const req = PushRequest.parse({
      sent_at_device: SAMPLE_ISO,
      clock_offset_ms: -250,
      commands: [
        {
          id: SAMPLE_UUID,
          type: 'FinalizeSale',
          schema_version: 1,
          device_seq: 0,
          created_at_device: SAMPLE_ISO,
          payload: { ok: true },
        },
      ],
    })
    expect(req.commands[0]?.depends_on).toEqual([])

    const res = PushResponse.parse({
      server_time: SAMPLE_ISO,
      results: [
        { id: SAMPLE_UUID, outcome: 'ACK', result: { invoiceNo: 'KSR1-1126-000001' } },
        {
          id: SAMPLE_UUID,
          outcome: 'ATTENTION',
          reason_class: 'STRUCTURAL',
          reason_code: 'VALIDATION_FAILED',
          ref: '20261119-140500-k7q2m',
        },
        { id: SAMPLE_UUID, outcome: 'RETRY' },
        { id: SAMPLE_UUID, outcome: 'HELD' },
      ],
    })
    expect(res.results).toHaveLength(4)

    expect(
      PingResponse.parse({ ok: true, server_time: 1_760_000_000_000, min_schema: 1, max_schema: 1 }),
    ).toBeTruthy()
    expect(ErrorEnvelope.parse({ error: { code: 'TIMEOUT', ref: '20261119-140500-k7q2m' } })).toBeTruthy()
  })

  it('menolak perintah > 50, UUID tidak sah, dan tipe perintah tidak dikenal', () => {
    const cmd = {
      id: SAMPLE_UUID,
      type: 'OpenShift',
      schema_version: 1,
      device_seq: 1,
      created_at_device: SAMPLE_ISO,
      payload: {},
    }
    expect(
      PushRequest.safeParse({
        sent_at_device: SAMPLE_ISO,
        clock_offset_ms: 0,
        commands: Array.from({ length: 51 }, () => cmd),
      }).success,
    ).toBe(false)

    expect(
      PushRequest.safeParse({
        sent_at_device: SAMPLE_ISO,
        clock_offset_ms: 0,
        commands: [{ ...cmd, id: 'not-a-uuid' }],
      }).success,
    ).toBe(false)

    expect(
      PushRequest.safeParse({
        sent_at_device: SAMPLE_ISO,
        clock_offset_ms: 0,
        commands: [{ ...cmd, type: 'InvalidCommand' }],
      }).success,
    ).toBe(false)
  })
})
