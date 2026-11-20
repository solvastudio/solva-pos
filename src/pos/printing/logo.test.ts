import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCachedAsset } from '../data/asset-cache.repo'
import { setMeta } from '../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { ensureLogo, rgbaTo1BitRaster } from './logo'

const T1 = '0192a000-0000-7000-8000-000000001a01'
const OUT = '0192a000-0000-7000-8000-000000001a02'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/printing/logo', () => {
  it('encodes 1-bit MSB raster, caches by sha256, skips unchanged fetch, and tolerates offline errors', async () => {
    // 8x1 row: left 4 pixels black, right 4 pixels white -> 0xF0
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ])
    const raster = rgbaTo1BitRaster(rgba, 8, 1)
    expect(Array.from(raster.bits)).toEqual([0xf0])

    const db = await openTenantDb(T1)
    await setMeta(db, 'device', {
      device_id: 'dev-1',
      credential: 'cred-1',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'demo',
      register_id: 'reg-1',
      outlet_id: OUT,
      register_type: 'CASHIER',
    })

    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const decodeRaster = vi.fn().mockResolvedValue(raster)

    const loaded = await ensureLogo(
      db,
      { outlet_id: OUT, logo_sha256: 'a'.repeat(64) },
      384,
      { fetchFn: fetchMock, decodeRaster },
    )
    expect(loaded).toEqual(raster)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await getCachedAsset(db, 'logo'))?.sha256).toBe('a'.repeat(64))

    // Unchanged sha256 skips network fetch
    await ensureLogo(
      db,
      { outlet_id: OUT, logo_sha256: 'a'.repeat(64) },
      384,
      { fetchFn: fetchMock, decodeRaster },
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Network failure on new hash does not throw
    const failFetch = vi.fn().mockRejectedValue(new TypeError('offline'))
    const offline = await ensureLogo(
      db,
      { outlet_id: OUT, logo_sha256: 'b'.repeat(64) },
      384,
      { fetchFn: failFetch, decodeRaster },
    )
    expect(offline).toBeNull()
  })
})
