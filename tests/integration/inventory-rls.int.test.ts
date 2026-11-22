import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closePools, withTenant } from '~/server/db'
import { setupInventoryTenant } from './helpers/inventory'

describe('inventory RLS across tenants (AD-07, SCHEMA §5.5)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('tenant B cannot see or write the balances of tenant A', async () => {
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

  it('composite FK rejects a SKU from another tenant on a balance', async () => {
    const a = await setupInventoryTenant('rls-fk-a')
    const b = await setupInventoryTenant('rls-fk-b')
    await expect(
      withTenant(a.tenantId, (tx) =>
        tx.execute(sql`INSERT INTO stock_balance (outlet_id, sku_id, tenant_id, qty, inventory_value) VALUES (${a.outletA}, ${b.skuA}, ${a.tenantId}, 1, 1000)`),
      ),
    ).rejects.toThrow()
  })
})
