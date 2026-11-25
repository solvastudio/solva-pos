import '@tanstack/react-start/server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { D } from '~/lib/kernel'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { withTenant, type TenantTx } from '~/server/db'
import { stockBalance } from './schema'

/** Active SKU options for stock document forms (GR, transfer, stocktake). UOM = the product's base UOM. */

export interface SkuOption {
  readonly skuId: string
  readonly skuCode: string
  readonly productName: string
  readonly baseUomId: string
  readonly baseUomCode: string
}

export async function listSkuOptions(actor: IdentityAuthActor): Promise<SkuOption[]> {
  requireActorPermission(actor, 'inventory.manage')
  return withTenant(actor.tenantId, async (tx) => {
    const res = await tx.execute<{
      sku_id: string
      sku_code: string
      product_name: string
      base_uom_id: string
      base_uom_code: string
    }>(sql`
      SELECT s.id AS sku_id, s.sku_code, p.name AS product_name, p.base_uom_id, u.code AS base_uom_code
      FROM sku s
      JOIN product p ON p.tenant_id = s.tenant_id AND p.id = s.product_id
      JOIN uom u ON u.tenant_id = p.tenant_id AND u.id = p.base_uom_id
      WHERE s.tenant_id = ${actor.tenantId}::uuid
        AND s.deleted_at IS NULL AND s.is_active
        AND p.deleted_at IS NULL AND p.is_active
      ORDER BY p.name, s.sku_code
      LIMIT 1000
    `)
    return res.rows.map((r) => ({
      skuId: r.sku_id,
      skuCode: r.sku_code,
      productName: r.product_name,
      baseUomId: r.base_uom_id,
      baseUomCode: r.base_uom_code,
    }))
  })
}

/**
 * Estimates per-SKU weighted average cost across positive stock balances in the tenant.
 */
export async function readTenantSkuAverageCosts(
  tx: TenantTx,
  tenantId: string,
  skuIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const out = new Map<string, number>()
  if (skuIds.length === 0) return out
  const rows = await tx
    .select({
      skuId: stockBalance.skuId,
      qty: stockBalance.qty,
      inventoryValue: stockBalance.inventoryValue,
    })
    .from(stockBalance)
    .where(and(eq(stockBalance.tenantId, tenantId), inArray(stockBalance.skuId, [...skuIds]), sql`${stockBalance.qty} > 0`))

  const totals = new Map<string, { qty: ReturnType<typeof D>; value: ReturnType<typeof D> }>()
  for (const r of rows) {
    const cur = totals.get(r.skuId) ?? { qty: D(0), value: D(0) }
    cur.qty = cur.qty.plus(D(r.qty))
    cur.value = cur.value.plus(D(r.inventoryValue))
    totals.set(r.skuId, cur)
  }
  for (const [skuId, t] of totals) {
    if (t.qty.gt(0)) {
      out.set(skuId, t.value.div(t.qty).round().toNumber())
    }
  }
  return out
}
