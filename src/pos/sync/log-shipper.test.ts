import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { countDeviceLogs, takePendingDeviceLogBatch } from '../data/device-log.repo'
import { setMeta } from '../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb, type SolvaDb } from '../db/solva-db'
import { logDevice } from '../maintenance/device-log'
import { createSyncClock } from './clock'
import { runDeviceLogShipper } from './log-shipper'

const TENANT_ID = '01950000-0000-7000-8000-000000000053'
let openedDb: SolvaDb | null = null

afterEach(async () => {
  if (openedDb) {
    openedDb.close()
    openedDb = null
  }
  await deleteTenantDbForTests(TENANT_ID)
})

async function setupPairedDb(): Promise<SolvaDb> {
  openedDb = await openTenantDb(TENANT_ID)
  await setMeta(openedDb, 'device', {
    device_id: 'dev-log-01',
    credential: 'cred-log-01',
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant_id: TENANT_ID,
    slug: 'kopi',
    register_id: 'reg-01',
    outlet_id: 'out-01',
    register_type: 'CASHIER',
  })
  return openedDb
}

describe('log-shipper', () => {
  it('ships up to 100 entries per cycle and removes only acknowledged batches', async () => {
    const db = await setupPairedDb()
    for (let i = 0; i < 105; i += 1) {
      await logDevice(
        db,
        {
          level: 'error',
          code: 'PRINT_FAILED',
          ctx: { idx: i },
        },
        {
          correctedNowMs: () => Date.parse('2026-11-20T01:00:00.000Z') + i * 1_000,
          rand: () => ((i % 97) + 1) / 100,
        },
      )
    }

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { entries: unknown[] }
      return new Response(JSON.stringify({ received: parsed.entries.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const clock = createSyncClock({ db })
    const res1 = await runDeviceLogShipper({ db, clock, fetch: fetchMock as typeof fetch })
    expect(res1).toEqual({ kind: 'ok', sent: 100 })
    expect(await countDeviceLogs(db)).toBe(5)

    const res2 = await runDeviceLogShipper({ db, clock, fetch: fetchMock as typeof fetch })
    expect(res2).toEqual({ kind: 'ok', sent: 5 })
    expect(await countDeviceLogs(db)).toBe(0)
  })

  it('keeps logs PENDING on 429/5xx without shifting last_success_sync_at or throwing', async () => {
    const db = await setupPairedDb()
    await setMeta(db, 'last_success_sync_at', '2026-11-20T00:30:00.000Z')

    await logDevice(db, {
      level: 'warn',
      code: 'SYNC_FAILED',
      ctx: { detail: 'timeout' },
    })

    const fetch429 = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', ref: 'rl-1' } }), {
        status: 429,
        headers: { 'Retry-After': '30' },
      })
    })

    const clock = createSyncClock({ db })
    const res = await runDeviceLogShipper({ db, clock, fetch: fetch429 as typeof fetch })
    expect(res.kind).toBe('deferred')

    const pending = await takePendingDeviceLogBatch(db, 100)
    expect(pending).toHaveLength(1)

    const lastSync = await db.meta.get('last_success_sync_at')
    expect(lastSync?.value).toBe('2026-11-20T00:30:00.000Z')
  })

  it('enforces 500-entry local device_log FIFO cap', async () => {
    const db = await setupPairedDb()
    for (let i = 0; i < 510; i += 1) {
      await logDevice(
        db,
        { level: 'info', code: 'UPDATE_REJECTED', ctx: { n: i } },
        {
          correctedNowMs: () => Date.parse('2026-11-20T01:00:00.000Z') + i * 1_000,
          rand: () => ((i % 90) + 5) / 100,
        },
      )
    }
    expect(await countDeviceLogs(db)).toBe(500)
  })
})
