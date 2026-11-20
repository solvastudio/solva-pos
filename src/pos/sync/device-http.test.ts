import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMeta, setMeta } from '../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { deviceFetch } from './device-http'

const T1 = '0192a000-0000-7000-8000-00000000a001'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/sync/device-http', () => {
  it('classifies ok, 429, 426 release updates, proxy-401 (transient), terminal auth locks, timeout, and network failures', async () => {
    const db = await openTenantDb(T1)
    await setMeta(db, 'device', {
      device_id: 'dev-1',
      credential: 'bearer-tok-1',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'acme',
      register_id: 'reg-1',
      outlet_id: 'out-1',
      register_type: 'CASHIER',
    })

    // 200 OK with headers verified
    const okFetch = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const h = init.headers as Headers
      expect(h.get('authorization')).toBe('Bearer bearer-tok-1')
      expect(h.get('x-schema-version')).toBe('1')
      expect(h.get('x-sync-protocol')).toBe('1')
      return new Response(
        JSON.stringify({ ok: true, server_time: '2026-11-20T05:00:00.000Z', max_schema_version: 2 }),
        { status: 200 },
      )
    })
    const okRes = await deviceFetch<{ ok: boolean }>('/api/pos/v1/pull', {
      db,
      method: 'POST',
      body: {},
      fetch: okFetch as unknown as typeof fetch,
    })
    expect(okRes.kind).toBe('ok')
    expect((await getMeta(db, 'sync_flags'))?.server_max_schema).toBe(2)

    // 429 rate limited parses Retry-After
    const rlRes = await deviceFetch('/api/pos/v1/push', {
      db,
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response('{}', { status: 429, headers: { 'Retry-After': '12' } }),
        ) as unknown as typeof fetch,
    })
    expect(rlRes).toEqual({ kind: 'rate_limited', retryAfterMs: 12_000 })

    // 401 without app error code -> transient server_error
    const proxy401 = await deviceFetch('/api/pos/v1/pull', {
      db,
      fetch: vi
        .fn()
        .mockResolvedValue(new Response('<html>Proxy 401</html>', { status: 401 })) as unknown as typeof fetch,
    })
    expect(proxy401).toEqual({ kind: 'server_error', status: 401 })

    // 403 DEVICE_REVOKED -> auth + persisted sync_flags.revoked
    const revokedRes = await deviceFetch('/api/pos/v1/pull', {
      db,
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: 'DEVICE_REVOKED', ref: 'r1' } }), {
            status: 403,
          }),
        ) as unknown as typeof fetch,
    })
    expect(revokedRes).toEqual({ kind: 'auth', code: 'DEVICE_REVOKED' })
    expect((await getMeta(db, 'sync_flags'))?.revoked).toBe(true)

    // 426 UPDATE_REQUIRED -> persists min_supported & update_required
    const updRes = await deviceFetch('/api/pos/v1/pull', {
      db,
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              release: {
                latest: 'v2.1.0',
                min_supported_app_version: 'v2.0.0',
                min_supported_schema_version: 2,
                is_mandatory: true,
                accept_previous_until: null,
                max_schema_version: 2,
              },
            }),
            { status: 426 },
          ),
        ) as unknown as typeof fetch,
    })
    expect(updRes.kind).toBe('update_required')
    expect((await getMeta(db, 'min_supported'))?.app_version).toBe('v2.0.0')

    // TimeoutError -> timeout; generic network throw -> network
    const timeoutErr = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    expect(
      await deviceFetch('/api/pos/v1/pull', {
        db,
        fetch: vi.fn().mockRejectedValue(timeoutErr) as unknown as typeof fetch,
      }),
    ).toEqual({ kind: 'timeout' })

    expect(
      await deviceFetch('/api/pos/v1/pull', {
        db,
        fetch: vi.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch,
      }),
    ).toEqual({ kind: 'network' })
  })
})
