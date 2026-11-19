import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonical-json'

describe('kernel/canonical-json', () => {
  it('sorts nested object keys deterministically and omits undefined object properties', () => {
    const a = canonicalJson({ b: 1, a: { d: 4, c: 3, ignored: undefined }, z: -0 })
    const b = canonicalJson({ z: 0, a: { c: 3, d: 4 }, b: 1 })
    expect(a).toBe('{"a":{"c":3,"d":4},"b":1,"z":0}')
    expect(a).toBe(b)
  })

  it('normalizes array undefined items and bigint cleanly', () => {
    expect(canonicalJson([1, undefined, 2n])).toBe('[1,null,"2"]')
  })
})
