import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closeRegistryDbForTests,
  findTenantIdBySlug,
} from '../db/registry'
import { deleteTenantDbForTests } from '../db/solva-db'
import { createInstanceLock } from '../locks/instance-lock'
import { getTenantStorage } from '../locks/tenant-storage'
import { pairDevice } from '../usecases/identity/pair-device'
import { bootPos } from './boot'
import { decideRoute } from './route-decision'
import { FakeBroadcastHub, FakeLockManager } from '../../../tests/helpers/fake-locks'

const T1 = '0192a000-0000-7000-8000-00000000a001'

afterEach(async () => {
  vi.restoreAllMocks()
  closeRegistryDbForTests()
  await deleteTenantDbForTests(T1)
})

describe('pos/boot + pair integration flow', () => {
  it('transitions from empty registry (pair) -> pairDevice -> offline bootPos -> login without network on boot', async () => {
    const locks = new FakeLockManager()
    const hub = new FakeBroadcastHub()
    const localMap = new Map<string, string>()

    const storageHelper = () =>
      getTenantStorage(T1, 'local', {
        getItem: (k) => localMap.get(k) ?? null,
        setItem: (k, v) => {
          localMap.set(k, v)
        },
        removeItem: (k) => {
          localMap.delete(k)
        },
      })

    // 1. Fresh browser boot -> NEEDS_PAIRING -> route: pair
    const initialBoot = await bootPos('acme', {
      registry: { findTenantIdBySlug },
      createLock: (tid, did) =>
        createInstanceLock({ tenantId: tid, deviceId: did, locks, channelFactory: (n) => hub.open(n) }),
      tenantStorage: storageHelper,
    })
    expect(decideRoute(initialBoot)).toEqual({ to: 'pair' })

    // 2. Online pairing via POST /api/pos/v1/enroll mock
    const enrollFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          device_id: '0192a000-0000-7000-8000-00000000d001',
          credential: 'cred-flow-token',
          credential_expires_at: '2027-01-01T00:00:00.000Z',
          tenant: { id: T1, slug: 'acme', name: 'Acme', default_locale: 'en-US' },
          outlet: {
            id: '0192a000-0000-7000-8000-00000000b001',
            code: 'OUT01',
            name: 'Outlet',
            timezone: 'Asia/Jakarta',
            day_cutoff_time: '00:00',
          },
          register: {
            id: '0192a000-0000-7000-8000-00000000c001',
            code: 'POS01',
            name: 'Cashier 1',
            register_type: 'CASHIER',
            paper_width_mm: 58,
          },
          server_time: Date.UTC(2026, 10, 20, 4, 0, 0),
        }),
        { status: 200 },
      ),
    )

    const pairRes = await pairDevice(
      { slug: 'acme', code: 'AB23-CD45', deviceName: 'POS 1' },
      {
        fetch: enrollFetch as unknown as typeof fetch,
        nowMs: () => Date.UTC(2026, 10, 20, 4, 0, 0),
        requestStoragePersist: async () => 'GRANTED',
        saveDeviceIdHint: (_tid, did) => storageHelper().set('device_id', did),
      },
    )
    expect(pairRes.ok).toBe(true)

    // 3. Offline boot check: zero fetch allowed during subsequent boot!
    const offlineFetchSpy = vi.fn()
    vi.stubGlobal('fetch', offlineFetchSpy)

    const afterPairBoot = await bootPos('acme', {
      registry: { findTenantIdBySlug },
      createLock: (tid, did) =>
        createInstanceLock({ tenantId: tid, deviceId: did, locks, channelFactory: (n) => hub.open(n) }),
      tenantStorage: storageHelper,
      nowMs: () => Date.UTC(2026, 10, 20, 4, 5, 0),
    })

    expect(offlineFetchSpy).not.toHaveBeenCalled()
    expect(afterPairBoot.kind).toBe('READY')
    expect(decideRoute(afterPairBoot)).toEqual({ to: 'login' })

    if (afterPairBoot.kind === 'READY') {
      afterPairBoot.releaseLock()
    }
  })
})
