import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import { closePools, withTenant } from '~/server/db'
import { setupInventoryTenant } from './helpers/inventory'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    globalThis.crypto.getRandomValues(b)
    return b[0]!
  },
})

describe('inventory schema constraints (SCHEMA §4.3.2–4.3.3, §5.4)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('stock_balance: qty 0 harus bernilai 0; qty negatif diizinkan (DB-02)', async () => {
    const t = await setupInventoryTenant('schema-bal')
    await expect(
      withTenant(t.tenantId, (tx) =>
        tx.execute(sql`INSERT INTO stock_balance (outlet_id, sku_id, tenant_id, qty, inventory_value) VALUES (${t.outletA}, ${t.skuA}, ${t.tenantId}, 0, 5)`),
      ),
    ).rejects.toThrow()
    await withTenant(t.tenantId, (tx) =>
      tx.execute(sql`INSERT INTO stock_balance (outlet_id, sku_id, tenant_id, qty, inventory_value) VALUES (${t.outletA}, ${t.skuA}, ${t.tenantId}, -2, -16000)`),
    )
  })

  it('stock_movement: tanda qty_delta dan value_delta harus konsisten (CHK sign)', async () => {
    const t = await setupInventoryTenant('schema-mov')
    await expect(
      withTenant(t.tenantId, (tx) =>
        tx.execute(sql`
          INSERT INTO stock_movement (id, tenant_id, outlet_id, processed_at, occurred_at, business_date, sku_id,
            movement_type, qty_delta, value_delta, qty_after, value_after, bal_seq, cost_basis, source_type, source_id)
          VALUES (${idGen.newId()}, ${t.tenantId}, ${t.outletA}, now(), now(), '2026-11-20', ${t.skuA},
            'GR_IN', 1, -5, 1, 0, 1, 'DECLARED', 'GR_LINE', ${idGen.newId()})`),
      ),
    ).rejects.toThrow()
  })
})
