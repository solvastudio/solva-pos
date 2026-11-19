import { describe, expect, it } from 'vitest'
import { createIdGenerator, isUuid } from './ids'

describe('kernel/ids', () => {
  it('menghasilkan UUIDv7 monoton saat nowMs naik maupun sama', () => {
    let now = 1_760_000_000_000
    let rng = 100
    const gen = createIdGenerator({
      nowMs: () => now,
      nextUint32: () => {
        rng = (rng + 1) >>> 0
        return rng
      },
    })

    const id1 = gen.newId()
    const id2 = gen.newId() // nowMs sama
    now += 1
    const id3 = gen.newId() // nowMs naik

    expect(isUuid(id1)).toBe(true)
    expect(isUuid(id2)).toBe(true)
    expect(isUuid(id3)).toBe(true)
    expect(id1).not.toBe(id2)
    expect(id1 < id2).toBe(true)
    expect(id2 < id3).toBe(true)
  })

  it('deterministik bila waktu dan RNG identik', () => {
    const mk = () => {
      let seed = 42
      return createIdGenerator({
        nowMs: () => 1_760_000_000_123,
        nextUint32: () => {
          seed = (seed * 1664525 + 1013904223) >>> 0
          return seed
        },
      })
    }

    const g1 = mk()
    const g2 = mk()
    expect(g1.newId()).toBe(g2.newId())
    expect(g1.newId()).toBe(g2.newId())
  })

  it('isUuid menolak huruf besar dan format salah', () => {
    expect(isUuid('019a0000-0000-7000-8000-000000000001')).toBe(true)
    expect(isUuid('019A0000-0000-7000-8000-000000000001')).toBe(false)
    expect(isUuid('019a0000-0000-7000-8000-00000000001')).toBe(false)
    expect(isUuid('019a0000000070008000000000000001')).toBe(false)
  })
})
