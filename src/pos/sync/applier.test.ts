import { afterEach, describe, expect, it } from 'vitest'
import { listOutlets } from '../data/master.repo'
import { getMeta, setMeta } from '../data/meta.repo'
import { readPullStageForCycle, stagePullRows } from '../data/pull-stage.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { applyFullResyncSnapshot, applyPullCycle } from './applier'

const T1 = '0192a000-0000-7000-8000-00000000a001'
const OUT_1 = '0192a000-0000-7000-8000-00000000b001'
const OUT_2 = '0192a000-0000-7000-8000-00000000b002'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/sync/applier (atomic master apply & full resync swap)', () => {
  it('applies staged upserts and tombstones atomically and clears pull_stage & meta.stage', async () => {
    const db = await openTenantDb(T1)
    await setMeta(db, 'stage', {
      cycle_id: 'cyc-1',
      upper: { version: 12, id: OUT_2 },
      stage_cursor: 2,
      pages: 2,
    })

    await stagePullRows(db, [
      {
        cycle_id: 'cyc-1',
        entity: 'outlet',
        op: 'upsert',
        id: OUT_1,
        version: 10,
        payload: {
          legal_entity_id: '0192a000-0000-7000-8000-00000000e001',
          code: 'O1',
          name: 'Outlet Old',
          timezone: 'Asia/Jakarta',
          day_cutoff_time: '00:00',
          price_tax_mode: 'INCLUSIVE',
          deleted_at: null,
        },
      },
      {
        cycle_id: 'cyc-1',
        entity: 'outlet',
        op: 'upsert',
        id: OUT_2,
        version: 11,
        payload: {
          legal_entity_id: '0192a000-0000-7000-8000-00000000e001',
          code: 'O2',
          name: 'Outlet Two',
          timezone: 'Asia/Jakarta',
          day_cutoff_time: '00:00',
          price_tax_mode: 'INCLUSIVE',
          deleted_at: null,
        },
      },
      {
        cycle_id: 'cyc-1',
        entity: 'outlet',
        op: 'delete',
        id: OUT_1,
        version: 12,
        payload: {},
      },
    ])

    await applyPullCycle(db, {
      cycleId: 'cyc-1',
      finalCursor: { version: 12, id: OUT_1 },
      catalogCursor: 12,
      immediate: true,
    })

    const outlets = await listOutlets(db)
    expect(outlets.map((o) => o.id)).toEqual([OUT_2])
    expect(await getMeta(db, 'cursor')).toEqual({ version: 12, id: OUT_1 })
    expect(await getMeta(db, 'catalog_cursor')).toBe(12)
    expect(await getMeta(db, 'stage')).toBeNull()
    expect(await readPullStageForCycle(db, 'cyc-1')).toEqual([])
  })

  it('replaces master tables during full resync without touching meta.device', async () => {
    const db = await openTenantDb(T1)
    await setMeta(db, 'device', {
      device_id: 'dev-keep',
      credential: 'cred-keep',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'acme',
      register_id: 'reg-1',
      outlet_id: OUT_1,
      register_type: 'CASHIER',
    })

    // Seed an old outlet that must vanish after full resync
    await stagePullRows(db, [
      {
        cycle_id: 'old-cyc',
        entity: 'outlet',
        op: 'upsert',
        id: OUT_1,
        version: 1,
        payload: { code: 'OLD', name: 'Old Outlet', deleted_at: null },
      },
    ])
    await applyPullCycle(db, {
      cycleId: 'old-cyc',
      finalCursor: { version: 1, id: OUT_1 },
      catalogCursor: 1,
      immediate: true,
    })

    await stagePullRows(db, [
      {
        cycle_id: 'full-1',
        entity: 'outlet',
        op: 'upsert',
        id: OUT_2,
        version: 50,
        payload: { code: 'NEW', name: 'Fresh Outlet', deleted_at: null },
      },
    ])

    await applyFullResyncSnapshot(db, {
      cycleId: 'full-1',
      snapshotVersion: 50,
      immediate: true,
    })

    const outlets = await listOutlets(db)
    expect(outlets.map((o) => o.id)).toEqual([OUT_2])
    expect((await getMeta(db, 'device'))?.device_id).toBe('dev-keep')
    expect(await getMeta(db, 'cursor')).toEqual({
      version: 50,
      id: '00000000-0000-0000-0000-000000000000',
    })
  })
})
