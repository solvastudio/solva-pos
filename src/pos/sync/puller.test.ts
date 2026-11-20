import { afterEach, describe, expect, it, vi } from 'vitest'
import { listOutlets } from '../data/master.repo'
import { getMeta, setMeta } from '../data/meta.repo'
import { readPullStageForCycle } from '../data/pull-stage.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { createSyncClock } from './clock'
import { runIncrementalPull } from './puller'

const T1 = '0192a000-0000-7000-8000-00000000a001'
const OUT_1 = '0192a000-0000-7000-8000-00000000b001'
const OUT_2 = '0192a000-0000-7000-8000-00000000b002'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

async function seedDevice(db: Awaited<ReturnType<typeof openTenantDb>>) {
  await setMeta(db, 'device', {
    device_id: 'dev-1',
    credential: 'cred-1',
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant_id: T1,
    slug: 'acme',
    register_id: 'reg-1',
    outlet_id: OUT_1,
    register_type: 'CASHIER',
  })
}

describe('pos/sync/puller (multi-page stage + crash resume + atomic commit)', () => {
  it('stages page 1, survives simulated mid-cycle interrupt, resumes page 2, and commits once', async () => {
    const db = await openTenantDb(T1)
    await seedDevice(db)
    const clock = createSyncClock({ db })

    const page1Fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            server_time: '2026-11-20T06:00:00.000Z',
            upper: 20,
            tombstone_floor: 0,
            rows: [
              {
                entity: 'outlet',
                op: 'upsert',
                id: OUT_1,
                version: 10,
                row: { code: 'O1', name: 'One', deleted_at: null },
              },
            ],
            next_cursor: { version: 10, id: OUT_1 },
            has_more: true,
            max_schema_version: 1,
            release: null,
          }),
          { status: 200 },
        ),
      )
      .mockRejectedValueOnce(new Error('Simulated network drop mid-cycle'))

    const res1 = await runIncrementalPull({
      db,
      clock,
      pushOk: true,
      immediateApply: true,
      fetch: page1Fetch as unknown as typeof fetch,
    })
    expect(res1).toEqual({ kind: 'transient' })

    // Master table MUST still be empty while cycle is incomplete!
    expect(await listOutlets(db)).toEqual([])
    const stageAfterDrop = await getMeta(db, 'stage')
    expect(stageAfterDrop?.pages).toBe(1)
    expect(stageAfterDrop?.cursor).toEqual({ version: 10, id: OUT_1 })

    // Next boot/sync resumes from meta.stage without re-requesting page 1!
    const page2Fetch = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        cycle: { id: string; upper: number } | null
        cursor: { version: number; id: string } | null
      }
      expect(body.cycle).toEqual({ id: stageAfterDrop!.cycle_id, upper: 20 })
      expect(body.cursor).toEqual({ version: 10, id: OUT_1 })

      return new Response(
        JSON.stringify({
          server_time: '2026-11-20T06:01:00.000Z',
          upper: 20,
          tombstone_floor: 0,
          rows: [
            {
              entity: 'outlet',
              op: 'upsert',
              id: OUT_2,
              version: 20,
              row: { code: 'O2', name: 'Two', deleted_at: null },
            },
          ],
          next_cursor: { version: 20, id: OUT_2 },
          has_more: false,
          max_schema_version: 1,
          release: null,
        }),
        { status: 200 },
      )
    })

    const res2 = await runIncrementalPull({
      db,
      clock,
      pushOk: true,
      immediateApply: true,
      fetch: page2Fetch as unknown as typeof fetch,
    })

    expect(res2.kind).toBe('ok')
    expect((await listOutlets(db)).map((o) => o.id).sort()).toEqual([OUT_1, OUT_2].sort())
    expect(await getMeta(db, 'cursor')).toEqual({ version: 20, id: OUT_2 })
    expect(await readPullStageForCycle(db, stageAfterDrop!.cycle_id)).toEqual([])
  })

  it('signals full_resync_required cleanly when server cursor is below tombstone floor', async () => {
    const db = await openTenantDb(T1)
    await seedDevice(db)
    const clock = createSyncClock({ db })

    const res = await runIncrementalPull({
      db,
      clock,
      pushOk: true,
      immediateApply: true,
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ full_resync_required: true, reason: 'CURSOR_BELOW_FLOOR' }),
            { status: 200 },
          ),
        ) as unknown as typeof fetch,
    })

    expect(res).toEqual({ kind: 'full_resync_required', reason: 'CURSOR_BELOW_FLOOR' })
    expect(await getMeta(db, 'full_resync')).toBe(true)
  })
})
