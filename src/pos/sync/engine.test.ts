import { afterEach, describe, expect, it, vi } from 'vitest'
import { listOutlets } from '../data/master.repo'
import { setMeta } from '../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { startSyncEngine } from './engine'
import { enqueueAudit } from '../usecases/audit/enqueue-audit'
import { FakeLockManager } from '../../../tests/helpers/fake-locks'

const T1 = '0192a000-0000-7000-8000-00000000a001'
const DEV_1 = '0192a000-0000-7000-8000-00000000d001'
const OUT_1 = '0192a000-0000-7000-8000-00000000b001'
const REG_1 = '0192a000-0000-7000-8000-00000000c001'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/sync/engine (in-process integration)', () => {
  it('stays inactive on passive lock and completes ping -> push -> pull -> lastSuccessAt on primary lock', async () => {
    const db = await openTenantDb(T1)
    await setMeta(db, 'device', {
      device_id: DEV_1,
      credential: 'cred-eng',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'acme',
      register_id: REG_1,
      outlet_id: OUT_1,
      register_type: 'CASHIER',
    })

    // Passive lock -> inactive no-op controller
    const passive = await startSyncEngine({
      db,
      tenantId: T1,
      deviceId: DEV_1,
      isPrimaryLock: false,
    })
    expect(passive.active).toBe(false)
    passive.stop()

    // Enqueue local AppendAudit command before starting primary engine
    const auditCmd = await enqueueAudit(db, {
      action: 'TEST_ENGINE',
      entityType: 'outlet',
      entityId: OUT_1,
      registerId: REG_1,
      occurredAtIso: '2026-11-20T08:00:00.000Z',
    })

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/pos/v1/ping') {
        return new Response(
          JSON.stringify({ ok: true, server_time: Date.UTC(2026, 10, 20, 8, 5, 0) }),
          { status: 200, headers: { 'X-App-Version': 'v1.0.0' } },
        )
      }
      if (url === '/api/pos/v1/push') {
        return new Response(
          JSON.stringify({
            server_time: '2026-11-20T08:05:01.000Z',
            results: [{ id: auditCmd.id, outcome: 'ACK', result: {} }],
          }),
          { status: 200 },
        )
      }
      if (url === '/api/pos/v1/pull') {
        return new Response(
          JSON.stringify({
            server_time: '2026-11-20T08:05:02.000Z',
            upper: 5,
            tombstone_floor: 0,
            rows: [
              {
                entity: 'outlet',
                op: 'upsert',
                id: OUT_1,
                version: 5,
                row: { code: 'O1', name: 'Synced Outlet', deleted_at: null },
              },
            ],
            next_cursor: { version: 5, id: OUT_1 },
            has_more: false,
            max_schema_version: 1,
            release: null,
          }),
          { status: 200 },
        )
      }
      // SSE signals endpoint: stay silent open stream
      return new Response(
        new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode(': connected\n\n'))
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    })

    const locks = new FakeLockManager()
    const ctrl = await startSyncEngine({
      db,
      tenantId: T1,
      deviceId: DEV_1,
      isPrimaryLock: true,
      locks,
      fetch: mockFetch as unknown as typeof fetch,
    })

    expect(ctrl.active).toBe(true)

    await vi.waitFor(
      async () => {
        const outlets = await listOutlets(db)
        expect(outlets).toHaveLength(1)
        expect(outlets[0]!.name).toBe('Synced Outlet')
        expect(ctrl.store.getState().lastSuccessAt).toBeTruthy()
        expect(ctrl.store.getState().queue.pending).toBe(0)
      },
      { timeout: 3_000 },
    )

    ctrl.stop()
    await ctrl.waitForIdle?.()
  })
})
