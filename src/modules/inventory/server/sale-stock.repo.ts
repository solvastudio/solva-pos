import '@tanstack/react-start/server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import { stockMovement } from './schema'

/** Outlet stock tracking activation time (BR-STK-004); `null` when not yet enabled. */
export async function loadInventoryEnabledAt(tx: TenantTx, tenantId: string, outletId: string): Promise<string | null> {
  const res = await tx.execute<{ enabled: string | null }>(sql`
    SELECT inventory_enabled_at::text AS enabled
    FROM outlet
    WHERE tenant_id = ${tenantId}::uuid AND id = ${outletId}::uuid
  `)
  return res.rows[0]?.enabled ?? null
}

/** SKUs whose stock is tracked: RETAIL products with `track_stock` (recipe consumption is handled elsewhere). */
export async function loadTrackedSkuIds(tx: TenantTx, tenantId: string, skuIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (skuIds.length === 0) return out
  const res = await tx.execute<{ id: string }>(sql`
    SELECT s.id
    FROM sku s
    JOIN product p ON p.tenant_id = s.tenant_id AND p.id = s.product_id
    WHERE s.tenant_id = ${tenantId}::uuid
      AND s.id IN (${sql.join(skuIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND p.track_stock = true
      AND p.product_type = 'RETAIL'
  `)
  for (const r of res.rows) out.add(r.id)
  return out
}

/** Source SALE and RECIPE_CONSUMPTION movements per sale line (used by void and return). */
export interface SaleOriginMovementRow {
  readonly id: string
  readonly sourceId: string
  readonly skuId: string
  readonly movementType: 'SALE' | 'RECIPE_CONSUMPTION'
  readonly qtyDelta: string
  readonly valueDelta: number
}

export async function findAllSaleMovements(
  tx: TenantTx,
  tenantId: string,
  sourceIds: readonly string[],
): Promise<SaleOriginMovementRow[]> {
  if (sourceIds.length === 0) return []
  const rows = await tx
    .select({
      id: stockMovement.id,
      sourceId: stockMovement.sourceId,
      skuId: stockMovement.skuId,
      movementType: stockMovement.movementType,
      qtyDelta: stockMovement.qtyDelta,
      valueDelta: stockMovement.valueDelta,
    })
    .from(stockMovement)
    .where(
      and(
        eq(stockMovement.tenantId, tenantId),
        inArray(stockMovement.movementType, ['SALE', 'RECIPE_CONSUMPTION']),
        inArray(stockMovement.sourceId, [...sourceIds]),
      ),
    )
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.sourceId,
    skuId: r.skuId,
    movementType: r.movementType as 'SALE' | 'RECIPE_CONSUMPTION',
    qtyDelta: r.qtyDelta,
    valueDelta: r.valueDelta,
  }))
}

/** Source SALE movement for each source (sale line id); used by void and return as `reverses_movement_id`. */
export async function findSaleMovementIds(
  tx: TenantTx,
  tenantId: string,
  sourceIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (sourceIds.length === 0) return out
  const rows = await tx
    .select({ id: stockMovement.id, sourceId: stockMovement.sourceId })
    .from(stockMovement)
    .where(
      and(
        eq(stockMovement.tenantId, tenantId),
        eq(stockMovement.movementType, 'SALE'),
        inArray(stockMovement.sourceId, [...sourceIds]),
      ),
    )
  for (const r of rows) out.set(r.sourceId, r.id)
  return out
}

export interface StockSnapshotRow {
  readonly skuId: string
  readonly qty: string
}

/** Quantity balance per SKU for an outlet (snapshot to the POS, without inventory value — MVP). */
export async function readOutletStockRows(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
): Promise<{ rows: StockSnapshotRow[]; lastMovementAt: string | null; count: number }> {
  const res = await tx.execute<{ sku_id: string; qty: string; last_movement_at: string | null }>(sql`
    SELECT sku_id, qty::text AS qty, last_movement_at::text AS last_movement_at
    FROM stock_balance
    WHERE tenant_id = ${tenantId}::uuid AND outlet_id = ${outletId}::uuid
    ORDER BY sku_id
  `)
  let lastMovementAt: string | null = null
  for (const r of res.rows) {
    if (r.last_movement_at && (lastMovementAt === null || r.last_movement_at > lastMovementAt)) {
      lastMovementAt = r.last_movement_at
    }
  }
  return {
    rows: res.rows.map((r) => ({ skuId: r.sku_id, qty: r.qty })),
    lastMovementAt,
    count: res.rows.length,
  }
}

/** Source movements per source for a given type (e.g. GR_IN for a GR reversal). */
export async function findMovementIdsBySource(
  tx: TenantTx,
  tenantId: string,
  sourceIds: readonly string[],
  movementType: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (sourceIds.length === 0) return out
  const rows = await tx
    .select({ id: stockMovement.id, sourceId: stockMovement.sourceId })
    .from(stockMovement)
    .where(
      and(
        eq(stockMovement.tenantId, tenantId),
        eq(stockMovement.movementType, movementType),
        inArray(stockMovement.sourceId, [...sourceIds]),
      ),
    )
  for (const r of rows) out.set(r.sourceId, r.id)
  return out
}

/** SKUs with balance ≥ 0 at an outlet (condition for resolving STOK_MINUS flags, ARCH §5.2). */
export async function nonNegativeSkuIds(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
  skuIds: readonly string[],
): Promise<string[]> {
  if (skuIds.length === 0) return []
  const res = await tx.execute<{ sku_id: string }>(sql`
    SELECT sku_id FROM stock_balance
    WHERE tenant_id = ${tenantId}::uuid AND outlet_id = ${outletId}::uuid
      AND qty >= 0
      AND sku_id IN (${sql.join(skuIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)
  return res.rows.map((r) => r.sku_id)
}
