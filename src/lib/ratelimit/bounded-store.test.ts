import { describe, expect, it } from 'vitest'
import { BoundedStore } from './bounded-store'

describe('BoundedStore', () => {
  it('expires entries at ttlMs using injected clock', () => {
    let nowMs = 1_000_000
    const store = new BoundedStore<{ blockedUntilMs: number }>({
      maxKeys: 10,
      ttlMs: 60_000,
      now: () => nowMs,
    })

    store.set('k1', { blockedUntilMs: 0 })
    expect(store.get('k1')).toEqual({ blockedUntilMs: 0 })

    nowMs += 59_999
    expect(store.get('k1')).toEqual({ blockedUntilMs: 0 })

    nowMs += 1
    expect(store.get('k1')).toBeUndefined()
  })

  it('bounds memory at maxKeys while protecting active blocks ahead of unprotected entries', () => {
    let nowMs = 10_000
    const store = new BoundedStore<{ blockedUntilMs: number }>({
      maxKeys: 5,
      ttlMs: 900_000,
      now: () => nowMs,
      isProtected: (v, t) => v.blockedUntilMs > t,
    })

    store.set('real-blocked-user', { blockedUntilMs: nowMs + 300_000 })
    for (let i = 0; i < 100; i += 1) {
      nowMs += 1
      store.set(`random-${i}`, { blockedUntilMs: 0 })
      expect(store.size).toBeLessThanOrEqual(5)
    }

    expect(store.get('real-blocked-user')).toEqual({ blockedUntilMs: 10_000 + 300_000 })
  })

  it('still stays strictly bounded if all entries are protected', () => {
    const nowMs = 10_000
    const store = new BoundedStore<{ blockedUntilMs: number }>({
      maxKeys: 3,
      ttlMs: 900_000,
      now: () => nowMs,
      isProtected: (v, t) => v.blockedUntilMs > t,
    })

    store.set('a', { blockedUntilMs: nowMs + 60_000 })
    store.set('b', { blockedUntilMs: nowMs + 60_000 })
    store.set('c', { blockedUntilMs: nowMs + 60_000 })
    store.set('d', { blockedUntilMs: nowMs + 60_000 })

    expect(store.size).toBe(3)
    expect(store.get('a')).toBeUndefined()
    expect(store.get('d')).toBeDefined()
  })
})
