import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { closeTenantDb, openTenantDb } from '../db/solva-db'
import { tenantDbName } from '../locks/names'
import { getMeta } from './meta.repo'
import { applyStockSnapshot, getEstimatesBulk } from './stock.repo'

const T = '0192a000-0000-7000-8000-00000000b001'
const SKU_A = '0192a000-0000-7000-8000-00000000c001'
const SKU_B = '0192a000-0000-7000-8000-00000000c002'

afterEach(async () => {
  closeTenantDb(T)
  await Dexie.delete(tenantDbName(T))
})

describe('pos/data/stock.repo', () => {
  it('applyStockSnapshot fully replaces stock_snapshot and stores the metadata', async () => {
    const db = await openTenantDb(T)
    await db.stock_snapshot.put({ sku_id: 'stale-sku', qty_on_hand: '99' })

    await applyStockSnapshot(db, {
      etag: '0123456789abcdef',
      as_of_server_time: '2026-11-20T10:00:00.000Z',
      acked_device_seq: 7,
      rows: [
        { sku_id: SKU_A, qty: '20' },
        { sku_id: SKU_B, qty: '-2' },
      ],
    })

    const rows = await db.stock_snapshot.orderBy('sku_id').toArray()
    expect(rows.map((r) => [r.sku_id, r.qty_on_hand])).toEqual([
      [SKU_A, '20'],
      [SKU_B, '-2'],
    ])
    expect(await getMeta(db, 'stock_snapshot_meta')).toEqual({
      etag: '0123456789abcdef',
      as_of_server_time: '2026-11-20T10:00:00.000Z',
      acked_device_seq: 7,
    })
  })

  it('getEstimatesBulk subtracts local sales not yet ACKed from the snapshot', async () => {
    const db = await openTenantDb(T)
    await applyStockSnapshot(db, {
      etag: '0123456789abcdef',
      as_of_server_time: '2026-11-20T10:00:00.000Z',
      acked_device_seq: 10,
      rows: [{ sku_id: SKU_A, qty: '20' }],
    })
    await db.outbox_command.put({
      id: '0192a000-0000-7000-8000-00000000d001',
      type: 'FinalizeSale',
      payload: { lines: [{ sku_id: SKU_A, qty_base: '6' }] },
      schema_version: 1,
      device_seq: 11,
      register_id: 'reg-1',
      status: 'PENDING',
      dependency_key: null,
      depends_on: [],
      attempts: 0,
      next_retry_at: null,
      last_error_class: null,
      last_error_code: null,
      last_error_ref: null,
      result: null,
      created_at_device: '2026-11-20T10:00:00.000Z',
      app_version: 'v0.3.0',
    } as never)

    const est = await getEstimatesBulk(db, [SKU_A, SKU_B])
    expect(est.get(SKU_A)).toBe('14')
    expect(est.get(SKU_B)).toBeNull()
  })
})
