import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { tenantDbName } from '../locks/names'
import { closeTenantDb, openTenantDb } from '../db/solva-db'
import type { MetaKey, MetaValueMap } from '../db/types'
import { bulkGetMeta, getMeta, setMeta } from './meta.repo'

const T = '0192a000-0000-7000-8000-00000000a001'

afterEach(async () => {
  closeTenantDb(T)
  await Dexie.delete(tenantDbName(T))
})

describe('pos/data/meta.repo', () => {
  it('round-trips every MetaKey with schema validation and single-call bulkGetMeta', async () => {
    const db = await openTenantDb(T)

    const samples: { [K in MetaKey]: MetaValueMap[K] } = {
      device: {
        device_id: 'dev-1',
        credential: 'cred-abc',
        credential_expires_at: '2027-01-01T00:00:00.000Z',
        tenant_id: T,
        slug: 'kopi-1',
        register_id: 'reg-1',
        outlet_id: 'out-1',
        register_type: 'CASHIER',
      },
      cursor: { version: 42, id: '0192f1c2-0000-7000-8000-000000000001' },
      catalog_cursor: 7,
      snapshot_version: 'snap-1',
      clock: {
        offset_ms: 1200,
        offset_at: '2026-11-20T01:00:00.000Z',
        max_seen_time: '2026-11-20T01:00:01.000Z',
      },
      last_success_sync_at: '2026-11-20T01:00:00.000Z',
      locale: 'en-US',
      idle_lock: {
        locked: false,
        locked_staff_id: null,
        locked_at: null,
        timeout_min: 10,
      },
      min_supported: {
        app_version: 'v1.0.0',
        schema_version: 1,
        is_mandatory: false,
      },
      stage: {
        cycle_id: 'cyc-1',
        upper: { version: 50, id: 'row-50' },
        stage_cursor: 3,
        pages: 2,
      },
      full_resync: true,
      storage: { persist: 'GRANTED', used_pct: 12.5 },
      printer: { mode: 'escpos', printer_id: 'usb-01', width_mm: 58 },
      dexie_version: 1,
      tenant: { id: T, name: 'Kopi Satu', default_locale: 'id-ID' },
      sync_protocol_version: 1,
      device_flags: { revoked: false, credential_expired: false, tenant_suspended: false },
      sync_flags: {
        revoked: false,
        credential_expired: false,
        tenant_suspended: false,
        update_required: false,
        server_max_schema: 1,
      },
    }

    for (const key of Object.keys(samples) as MetaKey[]) {
      await setMeta(db, key, samples[key] as never)
      expect(await getMeta(db, key)).toEqual(samples[key])
    }

    const batched = await bulkGetMeta(db, ['device', 'locale', 'clock', 'full_resync'])
    expect(batched).toEqual({
      device: samples.device,
      locale: 'en-US',
      clock: samples.clock,
      full_resync: true,
    })
  })

  it('rejects malformed values on write', async () => {
    const db = await openTenantDb(T)
    await expect(setMeta(db, 'locale', 'fr-FR' as never)).rejects.toThrow()
    await expect(setMeta(db, 'catalog_cursor', -5 as never)).rejects.toThrow()
    await expect(setMeta(db, 'storage', { persist: 'MAYBE', used_pct: 120 } as never)).rejects.toThrow()
  })
})
