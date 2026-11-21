import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { withTenant } from '~/server/db'

/** Pilihan SKU aktif untuk form dokumen stok (GR, transfer, opname). UOM = base UOM produk. */

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
