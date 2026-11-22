import { describe, expect, it } from 'vitest'
import { PullResponse, StockSnapshotBlockSchema } from './pull'

const SKU = '01a2004a-82dd-7747-8221-d2d7ed7f7049'

describe('stock snapshot contract (BR-STK-005)', () => {
  it('accepts canonical decimal quantities (integers and up to 4 decimals)', () => {
    const block = {
      etag: 'e6b72107c0a65be1',
      as_of_server_time: '2026-11-21T22:46:54.833Z',
      acked_device_seq: 0,
      rows: [
        { sku_id: SKU, qty: '20' },
        { sku_id: SKU, qty: '-2' },
        { sku_id: SKU, qty: '0.5000' },
      ],
    }
    expect(StockSnapshotBlockSchema.safeParse(block).success).toBe(true)
  })

  it('rejects non-numeric quantities', () => {
    const block = {
      etag: 'e6b72107c0a65be1',
      as_of_server_time: '2026-11-21T22:46:54.833Z',
      acked_device_seq: 0,
      rows: [{ sku_id: SKU, qty: 'dua puluh' }],
    }
    expect(StockSnapshotBlockSchema.safeParse(block).success).toBe(false)
  })

  it('last-page pull response with a stock block still parses (regression)', () => {
    const res = PullResponse.parse({
      server_time: '2026-11-21T22:46:54.833Z',
      upper: 1,
      tombstone_floor: 0,
      rows: [],
      next_cursor: null,
      has_more: false,
      max_schema_version: 1,
      release: null,
      stock: {
        etag: 'e6b72107c0a65be1',
        as_of_server_time: '2026-11-21T22:46:54.833Z',
        acked_device_seq: 0,
        rows: [{ sku_id: SKU, qty: '20' }],
      },
    })
    expect('stock' in res && res.stock !== undefined && res.stock !== 'unchanged').toBe(true)
  })
})
