import '@tanstack/react-start/server-only'
import { and, eq, sql } from 'drizzle-orm'
import { createIdGenerator, cmpQty, isUuid, parseQty, subQty, toMoney, type Money, type Qty } from '~/lib/kernel'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { AppError } from '~/server/error-classify'
import { withTenant, type TenantTx } from '~/server/db'
import { auditInventoryEvent } from './audit'
import { applyMovements, type MovementIntent } from './ledger.service'
import { draftDocNo, nextDocNo } from './doc-no'
import { stocktake as stocktakeTable, stocktakeLine as stocktakeLineTable } from './schema'
import { loadInventoryEnabledAt } from './sale-stock.repo'
import { applyAdjustment, emptyBalance, type StockBalance } from '../domain/costing'
import { resolveStockMinus } from './stock-flags.service'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    globalThis.crypto.getRandomValues(b)
    return b[0]!
  },
})

interface StocktakeHead {
  readonly id: string
  readonly outletId: string
  readonly status: string
  readonly docNo: string
  readonly businessDate: string
}

async function lockStocktake(tx: TenantTx, tenantId: string, id: string): Promise<StocktakeHead> {
  const res = await tx.execute<{ id: string; outlet_id: string; status: string; doc_no: string; business_date: string }>(sql`
    SELECT id, outlet_id, status, doc_no, business_date::text AS business_date
    FROM stocktake WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    FOR UPDATE
  `)
  const r = res.rows[0]
  if (!r) throw new AppError('VALIDATION_FAILED', 'Dokumen opname tidak ditemukan')
  return { id: r.id, outletId: r.outlet_id, status: r.status, docNo: r.doc_no, businessDate: r.business_date }
}

/** Current balance per SKU (for the value-impact preview). */
async function currentBalances(tx: TenantTx, tenantId: string, outletId: string, skuIds: readonly string[]): Promise<Map<string, StockBalance>> {
  const out = new Map<string, StockBalance>()
  if (skuIds.length === 0) return out
  const res = await tx.execute<{
    sku_id: string
    qty: string
    inventory_value: string | number
    ref_value: string | number
    ref_qty: string
    rev: string | number
  }>(sql`
    SELECT sku_id, qty::text AS qty, inventory_value, ref_value, ref_qty::text AS ref_qty, rev
    FROM stock_balance
    WHERE tenant_id = ${tenantId}::uuid AND outlet_id = ${outletId}::uuid
      AND sku_id IN (${sql.join(skuIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)
  for (const r of res.rows) {
    out.set(r.sku_id, {
      qty: parseQty(r.qty),
      inventoryValue: toMoney(Number(r.inventory_value)),
      refValue: toMoney(Number(r.ref_value)),
      refQty: parseQty(r.ref_qty),
      rev: Number(r.rev),
    })
  }
  return out
}

export interface StocktakeCreateInput {
  readonly outletId: string
  readonly businessDate: string
  readonly scope: 'ALL' | 'SELECTED'
  readonly skuIds?: readonly string[]
}

/** Creates a stocktake document with the current balance snapshot (BR-STK-030/031). Does not lock balances. */
export async function createStocktake(actor: IdentityAuthActor, input: StocktakeCreateInput): Promise<{ id: string; docNo: string; lineCount: number }> {
  requireActorPermission(actor, 'inventory.manage', { outletId: input.outletId })
  if (input.scope === 'SELECTED' && (!input.skuIds || input.skuIds.length === 0)) {
    throw new AppError('VALIDATION_FAILED', 'Pilih minimal satu SKU untuk opname parsial')
  }
  return withTenant(actor.tenantId, async (tx) => {
    const enabledAt = await loadInventoryEnabledAt(tx, actor.tenantId, input.outletId)
    if (!enabledAt) throw new AppError('VALIDATION_FAILED', 'admin.stock.trackingNotEnabled')

    const snapshotRows = await tx.execute<{ sku_id: string; qty: string }>(sql`
      SELECT sku_id, qty::text AS qty FROM stock_balance
      WHERE tenant_id = ${actor.tenantId}::uuid AND outlet_id = ${input.outletId}::uuid
      ORDER BY sku_id
    `)
    const qtyBySku = new Map(snapshotRows.rows.map((r) => [r.sku_id, r.qty]))
    const skuIds = input.scope === 'ALL' ? [...qtyBySku.keys()] : [...new Set(input.skuIds ?? [])]
    for (const id of skuIds) {
      if (!isUuid(id)) throw new AppError('VALIDATION_FAILED', 'SKU tidak valid')
    }
    if (skuIds.length === 0) throw new AppError('VALIDATION_FAILED', 'Tidak ada SKU untuk dihitung')

    const id = idGen.newId()
    const docNo = draftDocNo()
    const snapshotAt = new Date().toISOString()
    await tx.insert(stocktakeTable).values({
      id,
      tenantId: actor.tenantId,
      outletId: input.outletId,
      docNo,
      status: 'DRAFT',
      scope: input.scope,
      businessDate: input.businessDate,
      snapshotAt,
      createdBy: actor.appUserId,
    })
    await tx.insert(stocktakeLineTable).values(
      skuIds.map((skuId) => ({
        id: idGen.newId(),
        tenantId: actor.tenantId,
        stocktakeId: id,
        skuId,
        snapshotQty: qtyBySku.get(skuId) ?? '0',
      })),
    )
    return { id, docNo, lineCount: skuIds.length }
  })
}

export async function saveStocktakeCounts(
  actor: IdentityAuthActor,
  id: string,
  counts: readonly { lineId: string; countedQty: string }[],
): Promise<void> {
  return withTenant(actor.tenantId, async (tx) => {
    const cur = await lockStocktake(tx, actor.tenantId, id)
    requireActorPermission(actor, 'inventory.manage', { outletId: cur.outletId })
    if (cur.status !== 'DRAFT') throw new AppError('VALIDATION_FAILED', 'Opname sudah diposting atau dibatalkan')
    for (const c of counts) {
      const q = parseQty(c.countedQty)
      if (Number(q) < 0) throw new AppError('VALIDATION_FAILED', 'Hitungan tidak boleh negatif')
      await tx.execute(sql`
        UPDATE stocktake_line SET counted_qty = ${q}::numeric
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${c.lineId}::uuid AND stocktake_id = ${id}::uuid
      `)
    }
  })
}

interface StocktakeLineRow {
  readonly id: string
  readonly skuId: string
  readonly snapshotQty: Qty
  readonly countedQty: Qty | null
}

async function loadStocktakeLines(tx: TenantTx, tenantId: string, id: string): Promise<StocktakeLineRow[]> {
  const res = await tx.execute<{ id: string; sku_id: string; snapshot_qty: string; counted_qty: string | null }>(sql`
    SELECT id, sku_id, snapshot_qty::text AS snapshot_qty, counted_qty::text AS counted_qty
    FROM stocktake_line WHERE tenant_id = ${tenantId}::uuid AND stocktake_id = ${id}::uuid
    ORDER BY id
  `)
  return res.rows.map((r) => ({
    id: r.id,
    skuId: r.sku_id,
    snapshotQty: parseQty(r.snapshot_qty),
    countedQty: r.counted_qty === null ? null : parseQty(r.counted_qty),
  }))
}

/** Value-impact preview before posting (confirmation dialog). Uses the current balance; writes nothing. */
export async function previewStocktake(actor: IdentityAuthActor, id: string): Promise<{ lineCount: number; totalDeltaValue: number }> {
  return withTenant(actor.tenantId, async (tx) => {
    const res = await tx.execute<{ outlet_id: string; status: string }>(sql`
      SELECT outlet_id, status FROM stocktake WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${id}::uuid
    `)
    const head = res.rows[0]
    if (!head) throw new AppError('VALIDATION_FAILED', 'Dokumen opname tidak ditemukan')
    requireActorPermission(actor, 'inventory.manage', { outletId: head.outlet_id })
    const lines = await loadStocktakeLines(tx, actor.tenantId, id)
    const work = lines.filter((l) => l.countedQty !== null && cmpQty(subQty(l.countedQty!, l.snapshotQty), parseQty('0')) !== 0)
    const balances = await currentBalances(tx, actor.tenantId, head.outlet_id, work.map((l) => l.skuId))
    let total = 0
    for (const l of work) {
      const delta = subQty(l.countedQty!, l.snapshotQty)
      const r = applyAdjustment(balances.get(l.skuId) ?? emptyBalance(), delta)
      total += r.valueDelta
    }
    return { lineCount: work.length, totalDeltaValue: total }
  })
}

/**
 * Posts a stocktake (BR-STK-030..032): for each line, `delta = counted − snapshot` is applied as
 * ADJUST against the balance AT POSTING TIME (sales after the snapshot are not lost, BR-STK-031).
 */
export async function postStocktake(actor: IdentityAuthActor, id: string): Promise<{ docNo: string; totalDeltaValue: number; applied: number }> {
  return withTenant(actor.tenantId, async (tx) => {
    const cur = await lockStocktake(tx, actor.tenantId, id)
    requireActorPermission(actor, 'inventory.manage', { outletId: cur.outletId })
    if (cur.status !== 'DRAFT') throw new AppError('VALIDATION_FAILED', 'Opname sudah diposting atau dibatalkan')
    const enabledAt = await loadInventoryEnabledAt(tx, actor.tenantId, cur.outletId)
    if (!enabledAt) throw new AppError('VALIDATION_FAILED', 'admin.stock.trackingNotEnabled')

    const lines = await loadStocktakeLines(tx, actor.tenantId, id)
    if (lines.some((l) => l.countedQty === null)) {
      throw new AppError('VALIDATION_FAILED', 'Semua baris harus dihitung sebelum posting')
    }
    const docNo = await nextDocNo(tx, {
      tenantId: actor.tenantId,
      outletId: cur.outletId,
      kind: 'OPN',
      businessDate: cur.businessDate,
    })
    const nowIso = new Date().toISOString()
    const intents: MovementIntent[] = []
    const deltaLines: { line: StocktakeLineRow; delta: Qty }[] = []
    lines.forEach((l, i) => {
      const delta = subQty(l.countedQty!, l.snapshotQty)
      deltaLines.push({ line: l, delta })
      if (cmpQty(delta, parseQty('0')) !== 0) {
        intents.push({
          outletId: cur.outletId,
          skuId: l.skuId,
          kind: 'ADJUST',
          qty: delta,
          movementType: 'ADJUSTMENT',
          sourceType: 'STOCKTAKE_LINE',
          sourceId: l.id,
          occurredAt: nowIso,
          businessDate: cur.businessDate,
          order: i + 1,
        })
      }
    })

    const result = intents.length > 0
      ? await applyMovements(tx, { tenantId: actor.tenantId, actorId: actor.appUserId, processedAt: nowIso }, intents)
      : { applied: [], negativeResults: [] }
    const valueBySource = new Map(result.applied.map((a) => [a.sourceId, a.valueDelta]))

    let total = 0
    for (const { line } of deltaLines) {
      const v: Money = toMoney(valueBySource.get(line.id) ?? 0)
      total += v
      await tx.execute(sql`
        UPDATE stocktake_line SET delta_value = ${v}::bigint
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${line.id}::uuid
      `)
    }
    await tx
      .update(stocktakeTable)
      .set({ status: 'POSTED', postedAt: nowIso, postedBy: actor.appUserId, docNo, updatedAt: nowIso })
      .where(and(eq(stocktakeTable.tenantId, actor.tenantId), eq(stocktakeTable.id, id)))

    await resolveStockMinus(tx, {
      tenantId: actor.tenantId,
      outletId: cur.outletId,
      skuIds: deltaLines.map((d) => d.line.skuId),
    })
    await auditInventoryEvent(tx, {
      action: 'stocktake.posted',
      entityType: 'stocktake',
      entityId: id,
      outletId: cur.outletId,
      actorUserId: actor.appUserId,
      afterData: { doc_no: docNo, line_count: lines.length, adjusted: intents.length, total_delta_value: total },
    })
    return { docNo, totalDeltaValue: total, applied: intents.length }
  })
}

export async function cancelStocktake(actor: IdentityAuthActor, id: string): Promise<void> {
  return withTenant(actor.tenantId, async (tx) => {
    const cur = await lockStocktake(tx, actor.tenantId, id)
    requireActorPermission(actor, 'inventory.manage', { outletId: cur.outletId })
    if (cur.status !== 'DRAFT') throw new AppError('VALIDATION_FAILED', 'Hanya draft yang dapat dibatalkan')
    await tx
      .update(stocktakeTable)
      .set({ status: 'CANCELED', updatedAt: new Date().toISOString() })
      .where(and(eq(stocktakeTable.tenantId, actor.tenantId), eq(stocktakeTable.id, id)))
  })
}
