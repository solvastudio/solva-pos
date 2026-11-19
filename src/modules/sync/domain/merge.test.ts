import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { FeedKey } from './feed-types'
import { kWayMerge } from './merge'

function referenceSort(lists: readonly (readonly FeedKey[])[], limit: number): FeedKey[] {
  if (limit <= 0) return []
  return lists
    .flat()
    .sort((a, b) => {
      if (a.version !== b.version) return a.version - b.version
      if (a.id !== b.id) return a.id < b.id ? -1 : 1
      if (a.entity !== b.entity) return a.entity < b.entity ? -1 : 1
      return 0
    })
    .slice(0, limit)
}

const FEED_KEY_ARB = fc.record({
  entity: fc.constantFrom('outlet', 'payment_method', 'role', 'sku', 'price_entry'),
  version: fc.integer({ min: 1, max: 100 }),
  id: fc
    .integer({ min: 0, max: 9999 })
    .map((n) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`),
})

const SORTED_LIST_ARB = fc.array(FEED_KEY_ARB, { maxLength: 20 }).map((arr) =>
  [...arr].sort((a, b) => {
    if (a.version !== b.version) return a.version - b.version
    if (a.id !== b.id) return a.id < b.id ? -1 : 1
    if (a.entity !== b.entity) return a.entity < b.entity ? -1 : 1
    return 0
  }),
)

describe('sync/domain kWayMerge', () => {
  it('merges empty and edge-case inputs safely', () => {
    expect(kWayMerge([], 10)).toEqual([])
    expect(kWayMerge([[], []], 10)).toEqual([])
    expect(kWayMerge([[{ entity: 'a', version: 1, id: '1' }]], 0)).toEqual([])
  })

  it('breaks ties deterministically by id then entity', () => {
    const l1: FeedKey[] = [
      { entity: 'role', version: 2, id: '0002' },
      { entity: 'role', version: 3, id: '0001' },
    ]
    const l2: FeedKey[] = [
      { entity: 'outlet', version: 2, id: '0001' },
      { entity: 'alpha', version: 2, id: '0002' },
    ]

    expect(kWayMerge([l1, l2], 4)).toEqual([
      { entity: 'outlet', version: 2, id: '0001' },
      { entity: 'alpha', version: 2, id: '0002' },
      { entity: 'role', version: 2, id: '0002' },
      { entity: 'role', version: 3, id: '0001' },
    ])
  })

  it('matches concat+sort+slice on arbitrary sorted lists (>= 200 property runs)', () => {
    fc.assert(
      fc.property(
        fc.array(SORTED_LIST_ARB, { minLength: 0, maxLength: 6 }),
        fc.integer({ min: 0, max: 60 }),
        (lists, limit) => {
          const actual = kWayMerge(lists, limit)
          const expected = referenceSort(lists, limit)
          expect(actual).toEqual(expected)
        },
      ),
      { numRuns: 250 },
    )
  })
})
