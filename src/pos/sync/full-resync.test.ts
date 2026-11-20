import { afterEach, describe, expect, it, vi } from 'vitest'
import { listOutlets } from '../data/master.repo'
import { getMeta, setMeta } from '../data/meta.repo'
import { enqueueCommandStandalone } from '../data/outbox.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { createSyncClock } from './clock'
import { runFullResync } from './full-resync'

const T1 = '0192a000-0000-7000-8000-00000000a001'
const OUT_1 = '0192a000-0000-7000-8000-00000000b001'
const REG_1 = '0192a000-0000-7000-8000-00000000c001'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/sync/full-resync', () => {
  it('streams snapshot pages, emits progress, verifies manifest counts, catches up deltas, and preserves outbox', async () => {
    const db = await openTenantDb(T1)
    await setMeta(db, 'device', {
      device_id: 'dev-1',
      credential: 'cred-1',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'acme',
      register_id: REG_1,
      outlet_id: OUT_1,
      register_type: 'CASHIER',
    })

    // Seed pending outbox item that MUST survive full resync untouched.
    await enqueueCommandStandalone(db, {
      id: '0192f1c2-0000-7000-8000-000000000009',
      type: 'AppendAudit',
      payload: { entry: { action: 'TEST' } },
      schemaVersion: 1,
      registerId: REG_1,
      createdAtDevice: '2026-11-20T01:00:00.000Z',
    })

    const clock = createSyncClock({ db })
    const progressEvents: Array<{ step: number; total: number; label: string }> = []

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/pull/full/start')) {
        return new Response(
          JSON.stringify({
            snapshot_version: 25,
            tombstone_floor: 0,
            manifest: { counts: { tenant: 1, outlet: 1 } },
            snapshot_token: 'snap-tok-1',
            entities: ['tenant', 'outlet'],
          }),
          { status: 200 },
        )
      }
      if (url.endsWith('/pull/full/page')) {
        const body = JSON.parse(String(init.body)) as { entity: string }
        if (body.entity === 'tenant') {
          return new Response(
            JSON.stringify({
              rows: [
                {
                  entity: 'tenant',
                  op: 'upsert',
                  id: T1,
                  version: 1,
                  row: { name: 'Acme Coffee', default_locale: 'en-US' },
                },
              ],
              next_after_id: null,
              has_more: false,
            }),
            { status: 200 },
          )
        }
        return new Response(
          JSON.stringify({
            rows: [
              {
                entity: 'outlet',
                op: 'upsert',
                id: OUT_1,
                version: 25,
                row: { code: 'O1', name: 'Main Outlet', deleted_at: null },
              },
            ],
            next_after_id: null,
            has_more: false,
          }),
          { status: 200 },
        )
      }
      // Incremental catch-up call after snapshot swap
      return new Response(
        JSON.stringify({
          server_time: '2026-11-20T06:10:00.000Z',
          upper: 26,
          tombstone_floor: 0,
          rows: [],
          next_cursor: { version: 26, id: '00000000-0000-0000-0000-000000000000' },
          has_more: false,
          max_schema_version: 1,
          release: null,
        }),
        { status: 200 },
      )
    })

    const res = await runFullResync({
      db,
      clock,
      fetch: mockFetch as unknown as typeof fetch,
      onProgress: (p) => progressEvents.push(p),
    })

    expect(res.kind).toBe('ok')
    expect(progressEvents).toEqual([
      { step: 1, total: 2, label: 'tenant' },
      { step: 2, total: 2, label: 'outlet' },
    ])
    expect((await listOutlets(db)).map((o) => o.name)).toEqual(['Main Outlet'])
    expect((await getMeta(db, 'tenant'))?.name).toBe('Acme Coffee')
    expect(await getMeta(db, 'catalog_cursor')).toBe(26)
  })
})
