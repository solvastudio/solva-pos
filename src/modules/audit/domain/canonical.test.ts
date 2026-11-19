import { describe, expect, it } from 'vitest'
import { canonicalizeAudit, canonicalJson, type CanonicalAuditFields } from './canonical'

describe('audit/domain canonical serialization', () => {
  it('sorts object keys recursively and treats top-level undefined as null', () => {
    expect(canonicalJson(undefined)).toBe('null')
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson([1, undefined, { b: 2, a: 1 }])).toBe('[1,null,{"a":1,"b":2}]')

    const a = canonicalJson({ z: 1, nested: { b: true, a: 'x' }, a: [2, 1] })
    const b = canonicalJson({ a: [2, 1], nested: { a: 'x', b: true }, z: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":[2,1],"nested":{"a":"x","b":true},"z":1}')
  })

  it('produces deterministic inline snapshot across key insertion orders in canonicalizeAudit', () => {
    const base: CanonicalAuditFields = {
      id: '019a0000-0000-7000-8000-000000000001',
      tenantId: '019a0000-0000-7000-8000-000000000010',
      chainSeq: 1,
      outletId: null,
      registerId: null,
      deviceId: null,
      actorUserId: '019a0000-0000-7000-8000-000000000020',
      approverUserId: null,
      action: 'price.changed',
      entityType: 'price_entry',
      entityId: '019a0000-0000-7000-8000-000000000030',
      beforeData: { price: 15000, active: true },
      afterData: { active: true, price: 19000 },
      reasonCode: 'MANUAL',
      reasonText: 'Price adjustment',
      occurredAtDevice: null,
      clockOffsetMs: null,
      occurredAt: '2026-11-19T10:00:00.000Z',
      recordedAt: '2026-11-19T10:00:00.123Z',
      businessDate: '2026-11-19',
      commandId: null,
      requestRef: '20261119-100000-abcde',
      schemaVersion: null,
      appVersion: null,
    }

    const reordered: CanonicalAuditFields = {
      ...base,
      beforeData: { active: true, price: 15000 },
      afterData: { price: 19000, active: true, omitted: undefined },
    }

    expect(canonicalizeAudit(base)).toBe(canonicalizeAudit(reordered))
    expect(canonicalizeAudit(base)).toMatchInlineSnapshot(
      `"["019a0000-0000-7000-8000-000000000001","019a0000-0000-7000-8000-000000000010",1,null,null,null,"019a0000-0000-7000-8000-000000000020",null,"price.changed","price_entry","019a0000-0000-7000-8000-000000000030",{"active":true,"price":15000},{"active":true,"price":19000},"MANUAL","Price adjustment",null,null,"2026-11-19T10:00:00.000Z","2026-11-19T10:00:00.123Z","2026-11-19",null,"20261119-100000-abcde",null,null]"`,
    )
  })
})
