import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closePools, withTenant } from '~/server/db'
import { setupInventoryTenant } from './helpers/inventory'

describe('inventory RLS lintas tenant (AD-07, SCHEMA §5.5)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('tenant B tidak melihat dan tidak bisa menulis saldo tenant A', async () => {
    const a = await setupInventoryTenant('rls-a')
    const b = await setupInventoryTenant('rls-b')
    await withTenant(a.tenantId, (tx) =>
      tx.execute(sql`INSERT INTO stock_balance (outlet_id, sku_id, tenant_id, qty, inventory_value) VALUES (${a.outletA}, ${a.skuA}, ${a.tenantId}, 3, 3000)`),
    )

    const seenByB = await withTenant(b.tenantId, async (tx) => {
      const r = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM stock_balance`)
      return Number(r.rows[0]!.n)
    })
    expect(seenByB).toBe(0)

    await expect(
      withTenant(b.tenantId, (tx) =>
        tx.execute(sql`INSERT INTO stock_balance (outlet_id, sku_id, tenant_id, qty, inventory_value) VALUES (${a.outletA}, ${a.skuA}, ${a.tenantId}, 1, 1000)`),
      ),
    ).rejects.toThrow()
  })

  it('FK komposit menolak sku dari tenant lain pada saldo', async () => {
    const a = await setupInventoryTenant('rls-fk-a')
    const b = await setupInventoryTenant('rls-fk-b')
    await expect(
      withTenant(a.tenantId, (tx) =>
        tx.execute(sql`INSERT INTO stock_balance (outlet_id, sku_id, tenant_id, qty, inventory_value) VALUES (${a.outletA}, ${b.skuA}, ${a.tenantId}, 1, 1000)`),
      ),
    ).rejects.toThrow()
  })
})
