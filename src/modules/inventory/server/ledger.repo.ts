import '@tanstack/react-start/server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import { stockBalance, stockMovement } from './schema'

/** Kunci baris saldo yang dikunci: (outlet_id, sku_id) terurut ASC (AD-22). */
export interface BalanceKey {
  readonly outletId: string
  readonly skuId: string
}

export interface BalanceRow {
  readonly outletId: string
  readonly skuId: string
  readonly qty: string
  readonly inventoryValue: number
  readonly refValue: number
  readonly refQty: string
  readonly rev: number
}

export interface MovementInsert {
  readonly id: string
  readonly tenantId: string
  readonly outletId: string
  readonly skuId: string
  readonly processedAt: string
  readonly occurredAt: string
  readonly businessDate: string
  readonly movementType: string
  readonly qtyDelta: string
  readonly valueDelta: number
  readonly qtyAfter: string
  readonly valueAfter: number
  readonly balSeq: number
  readonly costBasis: string
  readonly isNegativeResult: boolean
  readonly sourceType: string
  readonly sourceId: string
  readonly reversesMovementId: string | null
  readonly commandId: string | null
  readonly createdBy: string | null
}

/** Batas tunggu kunci baris saldo (5 dtk); pemanggil memetakan `lock_not_available` ke RETRY (Fase 53). */
export async function setLedgerLockTimeout(tx: TenantTx): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
}

/** Membuat baris saldo yang belum ada (malas). Set-based, aman dari perlombaan (ON CONFLICT DO NOTHING). */
export async function ensureBalanceRows(tx: TenantTx, tenantId: string, keys: readonly BalanceKey[]): Promise<void> {
  if (keys.length === 0) return
  await tx
    .insert(stockBalance)
    .values(
      keys.map((k) => ({
        outletId: k.outletId,
        skuId: k.skuId,
        tenantId,
        qty: '0',
        inventoryValue: 0,
        refValue: 0,
        refQty: '0',
        rev: 0,
      })),
    )
    .onConflictDoNothing()
}

/**
 * Mengunci baris saldo `FOR UPDATE` dalam urutan (outlet_id, sku_id) ASC (AD-22).
 * Urutan ini mencegah deadlock antar transaksi yang menyentuh SKU yang sama.
 */
export async function lockBalancesOrdered(tx: TenantTx, tenantId: string, keys: readonly BalanceKey[]): Promise<BalanceRow[]> {
  if (keys.length === 0) return []
  const rows = await tx.execute<{
    outlet_id: string
    sku_id: string
    qty: string
    inventory_value: string | number
    ref_value: string | number
    ref_qty: string
    rev: string | number
  }>(sql`
    SELECT outlet_id, sku_id, qty::text AS qty, inventory_value, ref_value, ref_qty::text AS ref_qty, rev
    FROM stock_balance
    WHERE tenant_id = ${tenantId}::uuid
      AND (outlet_id, sku_id) IN (${sql.join(
        keys.map((k) => sql`(${k.outletId}::uuid, ${k.skuId}::uuid)`),
        sql`, `,
      )})
    ORDER BY outlet_id ASC, sku_id ASC
    FOR UPDATE
  `)
  return rows.rows.map((r) => ({
    outletId: r.outlet_id,
    skuId: r.sku_id,
    qty: r.qty,
    inventoryValue: Number(r.inventory_value),
    refValue: Number(r.ref_value),
    refQty: r.ref_qty,
    rev: Number(r.rev),
  }))
}

/** Movement yang sudah ada untuk kunci idempotensi (tenant, source_type, source_id, sku_id, movement_type). */
export async function findExistingMovements(
  tx: TenantTx,
  tenantId: string,
  keys: readonly { sourceType: string; sourceId: string; skuId: string; movementType: string }[],
): Promise<Map<string, { id: string; balSeq: number; valueDelta: number; qtyDelta: string; costBasis: string }>> {
  const out = new Map<string, { id: string; balSeq: number; valueDelta: number; qtyDelta: string; costBasis: string }>()
  if (keys.length === 0) return out
  const rows = await tx
    .select({
      id: stockMovement.id,
      sourceType: stockMovement.sourceType,
      sourceId: stockMovement.sourceId,
      skuId: stockMovement.skuId,
      movementType: stockMovement.movementType,
      balSeq: stockMovement.balSeq,
      valueDelta: stockMovement.valueDelta,
      qtyDelta: stockMovement.qtyDelta,
      costBasis: stockMovement.costBasis,
    })
    .from(stockMovement)
    .where(
      and(
        eq(stockMovement.tenantId, tenantId),
        inArray(stockMovement.sourceId, [...new Set(keys.map((k) => k.sourceId))]),
      ),
    )
  for (const r of rows) {
    out.set(`${r.sourceType}|${r.sourceId}|${r.skuId}|${r.movementType}`, {
      id: r.id,
      balSeq: r.balSeq,
      valueDelta: r.valueDelta,
      qtyDelta: r.qtyDelta,
      costBasis: r.costBasis,
    })
  }
  return out
}

/** Insert set-based untuk seluruh movement baru dalam satu panggilan. */
export async function insertMovements(tx: TenantTx, rows: readonly MovementInsert[]): Promise<void> {
  if (rows.length === 0) return
  await tx.insert(stockMovement).values(
    rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      outletId: r.outletId,
      skuId: r.skuId,
      processedAt: r.processedAt,
      occurredAt: r.occurredAt,
      businessDate: r.businessDate,
      movementType: r.movementType,
      qtyDelta: r.qtyDelta,
      valueDelta: r.valueDelta,
      qtyAfter: r.qtyAfter,
      valueAfter: r.valueAfter,
      balSeq: r.balSeq,
      costBasis: r.costBasis,
      isNegativeResult: r.isNegativeResult,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      reversesMovementId: r.reversesMovementId,
      commandId: r.commandId,
      createdBy: r.createdBy,
    })),
  )
}

/** Satu UPDATE per kunci saldo setelah seluruh intent kunci tersebut diterapkan. */
export async function updateBalance(
  tx: TenantTx,
  tenantId: string,
  key: BalanceKey,
  next: {
    qty: string
    inventoryValue: number
    refValue: number
    refQty: string
    rev: number
    lastMovementAt: string
    updatedAt: string
  },
): Promise<void> {
  await tx
    .update(stockBalance)
    .set({
      qty: next.qty,
      inventoryValue: next.inventoryValue,
      refValue: next.refValue,
      refQty: next.refQty,
      rev: next.rev,
      lastMovementAt: next.lastMovementAt,
      updatedAt: next.updatedAt,
    })
    .where(
      and(
        eq(stockBalance.tenantId, tenantId),
        eq(stockBalance.outletId, key.outletId),
        eq(stockBalance.skuId, key.skuId),
      ),
    )
}
