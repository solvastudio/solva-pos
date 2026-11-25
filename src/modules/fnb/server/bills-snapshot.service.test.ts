import { describe, expect, it } from 'vitest'
import { billsEtag } from './bills-snapshot.service'

describe('modules/fnb/server/bills-snapshot.service', () => {
  it('produces a deterministic 16-hex etag sensitive to outlet, timestamp, count and sum', () => {
    const a = billsEtag({
      outletId: 'out-1',
      maxLastEventAt: '2026-11-24T12:00:00.000Z',
      count: 2,
      sumLastEventSeq: 7,
    })
    const b = billsEtag({
      outletId: 'out-1',
      maxLastEventAt: '2026-11-24T12:00:00.000Z',
      count: 2,
      sumLastEventSeq: 7,
    })
    const c = billsEtag({
      outletId: 'out-1',
      maxLastEventAt: '2026-11-24T12:00:01.000Z',
      count: 2,
      sumLastEventSeq: 7,
    })
    const d = billsEtag({
      outletId: 'out-1',
      maxLastEventAt: '2026-11-24T12:00:00.000Z',
      count: 2,
      sumLastEventSeq: 8,
    })
    const e = billsEtag({
      outletId: 'out-2',
      maxLastEventAt: null,
      count: 0,
      sumLastEventSeq: 0,
    })

    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toBe(d)
    expect(a).not.toBe(e)
  })
})
