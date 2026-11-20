import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearClientErrorBufferForTests,
  getClientErrorBufferForTests,
} from '~/lib/client-errors/report-schema'
import { countDeviceLogs } from '../../data/device-log.repo'
import { getMeta } from '../../data/meta.repo'
import {
  closeRegistryDbForTests,
  findTenantIdBySlug,
} from '../../db/registry'
import { deleteTenantDbForTests } from '../../db/solva-db'
import { getTenantStorage } from '../../locks/tenant-storage'
import { pairDevice } from './pair-device'

const TENANT_ID = '0192a000-0000-7000-8000-00000000a001'
const SECRET_TOKEN = 'devtok_sentinel_must_never_be_logged_xyz987'

afterEach(async () => {
  clearClientErrorBufferForTests()
  closeRegistryDbForTests()
  await deleteTenantDbForTests(TENANT_ID)
})

function enrollSuccessBody() {
  return {
    device_id: '0192a000-0000-7000-8000-00000000d001',
    credential: SECRET_TOKEN,
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant: {
      id: TENANT_ID,
      slug: 'acme',
      name: 'Acme Coffee',
      default_locale: 'en-US',
    },
    outlet: {
      id: '0192a000-0000-7000-8000-00000000b001',
      code: 'OUT01',
      name: 'Main Outlet',
      timezone: 'Asia/Jakarta',
      day_cutoff_time: '00:00',
    },
    register: {
      id: '0192a000-0000-7000-8000-00000000c001',
      code: 'POS01',
      name: 'Cashier 1',
      register_type: 'CASHIER',
      paper_width_mm: 80,
    },
    server_time: 1_795_095_855_000,
  }
}

describe('pos/usecases/identity/pair-device', () => {
  it('writes meta.device, meta.tenant, clock, registry, storage persist, and never logs token', async () => {
    const store = new Map<string, string>()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(enrollSuccessBody()), { status: 200 }),
    )

    const res = await pairDevice(
      { slug: 'acme', code: 'AB23-CD45', deviceName: 'Front Counter iPad' },
      {
        fetch: mockFetch as unknown as typeof fetch,
        nowMs: () => 1_795_095_850_000,
        requestStoragePersist: async () => 'GRANTED',
        saveDeviceIdHint: (tid, did) => {
          getTenantStorage(tid, 'local', {
            getItem: (k) => store.get(k) ?? null,
            setItem: (k, v) => {
              store.set(k, v)
            },
            removeItem: (k) => {
              store.delete(k)
            },
          }).set('device_id', did)
        },
      },
    )

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(await findTenantIdBySlug('acme')).toBe(TENANT_ID)
      const deviceMeta = await getMeta(res.db, 'device')
      expect(deviceMeta?.credential).toBe(SECRET_TOKEN)
      expect(deviceMeta?.register_id).toBe('0192a000-0000-7000-8000-00000000c001')
      expect(await getMeta(res.db, 'locale')).toBe('en-US')
      expect((await getMeta(res.db, 'clock'))?.offset_ms).toBe(5_000)
      expect(await res.syncHandle.done).toBe('OK')

      // Token sentinel: must never leak into client log buffer or IndexedDB device_log.
      expect(JSON.stringify(getClientErrorBufferForTests())).not.toContain(SECRET_TOKEN)
      expect(await countDeviceLogs(res.db)).toBe(0)
    }
  })

  it('maps server and network failures cleanly to specific UI error keys', async () => {
    const makeErrFetch = (status: number, body: Record<string, unknown>) =>
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

    expect(
      await pairDevice({ slug: 'acme', code: 'AB23CD45' }, {
        fetch: makeErrFetch(400, { error: { code: 'VALIDATION_FAILED' } }),
      }),
    ).toEqual({ ok: false, error: 'INVALID', ref: undefined })

    expect(
      await pairDevice({ slug: 'acme', code: 'AB23CD45' }, {
        fetch: makeErrFetch(429, { error: { code: 'RATE_LIMITED' } }),
      }),
    ).toEqual({ ok: false, error: 'RATE_LIMITED', ref: undefined })

    expect(
      await pairDevice({ slug: 'acme', code: 'AB23CD45' }, {
        fetch: makeErrFetch(409, { error: { code: 'REGISTER_HAS_ACTIVE_DEVICE' } }),
      }),
    ).toEqual({ ok: false, error: 'REGISTER_BUSY', ref: undefined })

    expect(
      await pairDevice({ slug: 'acme', code: 'AB23CD45' }, {
        fetch: makeErrFetch(403, { error: { code: 'TENANT_SUSPENDED' } }),
      }),
    ).toEqual({ ok: false, error: 'SUSPENDED', ref: undefined })

    expect(
      await pairDevice({ slug: 'acme', code: 'AB23CD45' }, {
        fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, error: 'NETWORK' })
  })
})
