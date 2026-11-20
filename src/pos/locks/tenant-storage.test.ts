import { describe, expect, it } from 'vitest'
import { getTenantStorage, type StorageLike } from './tenant-storage'

function makeMemoryStorage(): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
    dump: () => Object.fromEntries(map.entries()),
  }
}

describe('pos/locks/tenant-storage', () => {
  it('namespaces keys with solva:<tenantId>: and isolates tenants sharing the same storage', () => {
    const raw = makeMemoryStorage()
    const tA = getTenantStorage('tenant-a', 'session', raw)
    const tB = getTenantStorage('tenant-b', 'session', raw)

    expect(tA.rawKey('bootfail')).toBe('solva:tenant-a:bootfail')
    expect(tA.set('bootfail', '[123]')).toBe(true)
    expect(tB.set('bootfail', '[456]')).toBe(true)

    expect(tA.get('bootfail')).toBe('[123]')
    expect(tB.get('bootfail')).toBe('[456]')
    expect(raw.dump()).toEqual({
      'solva:tenant-a:bootfail': '[123]',
      'solva:tenant-b:bootfail': '[456]',
    })

    tA.remove('bootfail')
    expect(tA.get('bootfail')).toBeNull()
    expect(tB.get('bootfail')).toBe('[456]')
  })

  it('degrades gracefully when browser storage throws or is unavailable', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }

    const s = getTenantStorage('t1', 'local', broken)
    expect(s.get('k')).toBeNull()
    expect(s.set('k', 'v')).toBe(false)
    expect(() => s.remove('k')).not.toThrow()

    const nullStorage = getTenantStorage('t1', 'local', null)
    expect(nullStorage.get('k')).toBeNull()
    expect(nullStorage.set('k', 'v')).toBe(false)
  })
})
