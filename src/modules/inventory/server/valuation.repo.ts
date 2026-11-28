import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import { outletInScopeSql } from './outlet-scope'

/** Raw R-02 rows from `v_stock_valuation`, enriched with names and effective availability. */
export interface ValuationRawRow {
  readonly outletId: string
  readonly outletCode: string
  readonly outletName: string
  readonly skuId: string
  readonly skuCode: string
  readonly productName: string
  readonly qty: string
  readonly inventoryValue: number
  readonly isNegative: boolean
  readonly qtyInTransit: string
  readonly valueInTransit: number
  readonly availability: string
}

export interface ValuationQuery {
  /** Outlets the caller may see; `null` means no restriction (tenant-wide access). */
  readonly outletIds: readonly string[] | null
  readonly outletId?: string
  readonly categoryId?: string
  readonly onlyNegative?: boolean
  readonly onlyInTransit?: boolean
}

/**
 * Effective availability: a SKU row wins over a product row (ARCH catalog). No row means `AVAILABLE`.
 * Inactive rows (deleted_at) are ignored.
 */
export async function queryValuation(tx: TenantTx, tenantId: string, q: ValuationQuery): Promise<ValuationRawRow[]> {
  const outletCond = q.outletId ? sql`AND v.outlet_id = ${q.outletId}::uuid` : sql``
  const scopeCond = q.outletIds === null ? sql`` : sql`AND ${outletInScopeSql(sql`v.outlet_id`, q.outletIds)}`
  const categoryCond = q.categoryId ? sql`AND p.category_id = ${q.categoryId}::uuid` : sql``
  const negativeCond = q.onlyNegative ? sql`AND v.is_negative` : sql``
  const transitCond = q.onlyInTransit ? sql`AND v.qty_in_transit > 0` : sql``

  const res = await tx.execute<{
    outlet_id: string
    outlet_code: string
    outlet_name: string
    sku_id: string
    sku_code: string
    product_name: string
    qty: string
    inventory_value: string | number
    is_negative: boolean
    qty_in_transit: string
    value_in_transit: string | number
    availability: string
  }>(sql`
    SELECT v.outlet_id, o.code AS outlet_code, o.name AS outlet_name,
           v.sku_id, s.sku_code, p.name AS product_name,
           v.qty::text AS qty, v.inventory_value, v.is_negative,
           v.qty_in_transit::text AS qty_in_transit, v.value_in_transit,
           COALESCE(
             (SELECT a.status FROM item_outlet_availability a
               WHERE a.tenant_id = v.tenant_id AND a.outlet_id = v.outlet_id
                 AND a.product_id = s.product_id AND a.sku_id = v.sku_id AND a.deleted_at IS NULL
               LIMIT 1),
             (SELECT a.status FROM item_outlet_availability a
               WHERE a.tenant_id = v.tenant_id AND a.outlet_id = v.outlet_id
                 AND a.product_id = s.product_id AND a.sku_id IS NULL AND a.deleted_at IS NULL
               LIMIT 1),
             'AVAILABLE'
           ) AS availability
    FROM v_stock_valuation v
    JOIN sku s ON s.tenant_id = v.tenant_id AND s.id = v.sku_id
    JOIN product p ON p.tenant_id = v.tenant_id AND p.id = s.product_id
    JOIN outlet o ON o.tenant_id = v.tenant_id AND o.id = v.outlet_id
    WHERE v.tenant_id = ${tenantId}::uuid
      ${outletCond} ${scopeCond} ${categoryCond} ${negativeCond} ${transitCond}
    ORDER BY o.code, s.sku_code, v.sku_id
  `)

  return res.rows.map((r) => ({
    outletId: r.outlet_id,
    outletCode: r.outlet_code,
    outletName: r.outlet_name,
    skuId: r.sku_id,
    skuCode: r.sku_code,
    productName: r.product_name,
    qty: r.qty,
    inventoryValue: Number(r.inventory_value),
    isNegative: r.is_negative,
    qtyInTransit: r.qty_in_transit,
    valueInTransit: Number(r.value_in_transit),
    availability: r.availability,
  }))
}
