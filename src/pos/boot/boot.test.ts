import { afterEach, describe, expect, it, vi } from 'vitest'
import { setMeta } from '../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import type { InstanceLockHandle } from '../locks/instance-lock'
import { getTenantStorage } from '../locks/tenant-storage'
import { bootPos } from './boot'

const T1 = '0192a000-0000-7000-8000-00000000a001'

function makeMockLock(role: 'primary' | 'passive'): InstanceLockHandle {
  return {
    state: role,
    acquire: vi.fn().mockResolvedValue(role),
    sendMessage: vi.fn(),
    onPromoted: vi.fn().mockReturnValue(() => {}),
    onStateChange: vi.fn().mockReturnValue(() => {}),
    onMessage: vi.fn().mockReturnValue(() => {}),
    release: vi.fn(),
  }
}

function makeMemoryTenantStorage() {
  const map = new Map<string, string>()
  return getTenantStorage(T1, 'local', {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  await deleteTenantDbForTests(T1)
})

describe('pos/boot/boot (offline-first boot sequence)', () => {
  it('returns NEEDS_PAIRING without opening any DB or calling fetch when slug is not registered', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const openDbSpy = vi.fn()

    const res = await bootPos('unknown-shop', {
      registry: { findTenantIdBySlug: async () => null },
      openDb: openDbSpy,
    })

    expect(res).toEqual({ kind: 'NEEDS_PAIRING', reason: 'UNKNOWN_SLUG' })
    expect(openDbSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns PASSIVE_DUPLICATE without opening Dexie when lock is passive', async () => {
    const openDbSpy = vi.fn()
    const res = await bootPos('kopi', {
      registry: { findTenantIdBySlug: async () => T1 },
      createLock: () => makeMockLock('passive'),
      tenantStorage: makeMemoryTenantStorage,
      openDb: openDbSpy,
    })

    expect(res.kind).toBe('PASSIVE_DUPLICATE')
    expect(openDbSpy).not.toHaveBeenCalled()
  })

  it('returns LOCAL_DB_FAILED without throwing or deleting DB if openTenantDb rejects', async () => {
    const mockLock = makeMockLock('primary')
    const res = await bootPos('kopi', {
      registry: { findTenantIdBySlug: async () => T1 },
      createLock: () => mockLock,
      tenantStorage: makeMemoryTenantStorage,
      openDb: async () => {
        throw new Error('IDB quota/corruption error')
      },
    })

    expect(res.kind).toBe('LOCAL_DB_FAILED')
    if (res.kind === 'LOCAL_DB_FAILED') {
      expect(res.ref).toMatch(/^D-\d{8}-\d{6}-[a-hj-km-np-z2-9]{5}$/)
    }
    expect(mockLock.release).toHaveBeenCalledTimes(1)
  })

  it('boots cleanly from IndexedDB metadata to READY with zero network calls', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const db = await openTenantDb(T1)
    await setMeta(db, 'device', {
      device_id: 'dev-1',
      credential: 'cred-1',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'kopi',
      register_id: 'reg-1',
      outlet_id: 'out-1',
      register_type: 'CASHIER',
    })
    await setMeta(db, 'tenant', {
      id: T1,
      name: 'Kopi Satu',
      default_locale: 'en-US',
    })
    await setMeta(db, 'last_success_sync_at', '2026-11-20T00:00:00.000Z')
    await setMeta(db, 'clock', {
      offset_ms: 0,
      offset_at: '2026-11-20T00:00:00.000Z',
      max_seen_time: '2026-11-20T00:00:00.000Z',
    })

    const res = await bootPos('kopi', {
      registry: { findTenantIdBySlug: async () => T1 },
      createLock: () => makeMockLock('primary'),
      tenantStorage: makeMemoryTenantStorage,
      openDb: async () => db,
      nowMs: () => Date.parse('2026-11-20T02:00:00.000Z'),
    })

    expect(res.kind).toBe('READY')
    if (res.kind === 'READY') {
      expect(res.state).toEqual({ kind: 'OK' })
      expect(res.locale).toBe('en-US')
      expect(res.device.device_id).toBe('dev-1')
      res.releaseLock()
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
