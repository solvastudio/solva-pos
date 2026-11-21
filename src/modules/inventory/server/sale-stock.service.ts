import '@tanstack/react-start/server-only'
import { addQty, cmpQty, normalizeQty, proRate, subMoney, subQty, toMoney, type Money, type Qty } from '~/lib/kernel'
import type { TenantTx } from '~/server/db'
import { ZERO_QTY } from '../domain/costing'
import { applyMovements, type MovementIntent } from './ledger.service'
import {
  findSaleMovementIds,
  loadInventoryEnabledAt,
  loadTrackedSkuIds,
  readOutletStockRows,
} from './sale-stock.repo'

/**
 * Integrasi stok penjualan (Fase 53): HPP otoritatif dihitung server saat memproses (BR-HPP-004).
 * Tidak pernah menolak transaksi karena stok (AP-02); saldo negatif hanya ditandai.
 */

export interface SaleStockLine {
  readonly lineId: string
  readonly lineNo: number
  readonly lineKind: 'ITEM' | 'SHARE' | 'STOCK_BASIS'
  readonly skuId: string | null
  readonly qtyBase: Qty
}

export interface SaleStockInput {
  readonly tenantId: string
  readonly outletId: string
  readonly saleId: string
  readonly occurredAt: string
  readonly businessDate: string
  readonly processedAt: string
  readonly commandId: string | null
  readonly actorId: string | null
  readonly lines: readonly SaleStockLine[]
}

export interface SaleStockResult {
  /** Jumlah HPP baris yang dilacak; `null` bila tak ada baris yang dilacak (BR-STK-004). */
  readonly costTotal: Money | null
  readonly lines: readonly { readonly lineId: string; readonly costSnapshot: Money | null }[]
  readonly negativeResults: readonly { readonly outletId: string; readonly skuId: string; readonly qtyAfter: Qty }[]
}

function noStock(lines: readonly SaleStockLine[]): SaleStockResult {
  return {
    costTotal: null,
    lines: lines.map((l) => ({ lineId: l.lineId, costSnapshot: null })),
    negativeResults: [],
  }
}

/**
 * Menulis movement `SALE` per baris ITEM yang dilacak dan mengembalikan `cost_snapshot` per baris.
 * Movement hanya dibuat bila outlet sudah diaktifkan dan `processed_at >= inventory_enabled_at` (asumsi 2).
 */
export async function applySaleStock(tx: TenantTx, input: SaleStockInput): Promise<SaleStockResult> {
  const enabledAt = await loadInventoryEnabledAt(tx, input.tenantId, input.outletId)
  if (!enabledAt || Date.parse(input.processedAt) < Date.parse(enabledAt)) {
    return noStock(input.lines)
  }

  const skuIds = input.lines.filter((l) => l.lineKind === 'ITEM' && l.skuId).map((l) => l.skuId!)
  const tracked = await loadTrackedSkuIds(tx, input.tenantId, [...new Set(skuIds)])
  const trackedLines = input.lines.filter((l) => l.lineKind === 'ITEM' && l.skuId && tracked.has(l.skuId))
  if (trackedLines.length === 0) {
    return noStock(input.lines)
  }

  const intents: MovementIntent[] = trackedLines.map((l) => ({
    outletId: input.outletId,
    skuId: l.skuId!,
    kind: 'OUT',
    qty: l.qtyBase,
    movementType: 'SALE',
    sourceType: 'SALE_LINE',
    sourceId: l.lineId,
    occurredAt: input.occurredAt,
    businessDate: input.businessDate,
    order: l.lineNo,
  }))

  const result = await applyMovements(
    tx,
    { tenantId: input.tenantId, commandId: input.commandId, actorId: input.actorId, processedAt: input.processedAt },
    intents,
  )

  const costByLine = new Map<string, Money>()
  for (const a of result.applied) {
    costByLine.set(a.sourceId, toMoney(-a.valueDelta))
  }

  let total = 0
  const lines = input.lines.map((l) => {
    const cost = costByLine.get(l.lineId) ?? null
    if (cost !== null) total += cost
    return { lineId: l.lineId, costSnapshot: cost }
  })

  return {
    costTotal: costByLine.size > 0 ? toMoney(total) : null,
    lines,
    negativeResults: result.negativeResults,
  }
}

/** Baris void: nilai HPP asal dikurangi porsi yang sudah diretur kembali ke stok (BR-HPP-007). */
export interface VoidStockLine {
  readonly lineId: string
  readonly lineNo: number
  readonly skuId: string | null
  readonly qtyBase: Qty
  /** `cost_snapshot` baris penjualan; `null` bila baris tidak punya movement. */
  readonly costSnapshot: Money | null
  /** Σ qty_returned_base untuk retur `KEMBALI_STOK` sebelumnya. */
  readonly returnedQtyBase: Qty
  /** Σ cost_returned untuk retur sebelumnya. */
  readonly returnedCost: Money
}

export interface VoidStockInput {
  readonly tenantId: string
  readonly outletId: string
  readonly occurredAt: string
  readonly businessDate: string
  readonly processedAt: string
  readonly commandId: string | null
  readonly actorId: string | null
  readonly lines: readonly VoidStockLine[]
}

/** Membalik porsi yang belum diretur dengan `SALE_VOID` (idempoten per baris). */
export async function applyVoidStock(
  tx: TenantTx,
  input: VoidStockInput,
): Promise<{ readonly reversed: readonly { lineId: string; qtyBase: Qty; valueBase: Money }[] }> {
  const candidates = input.lines.filter((l) => l.skuId !== null && l.costSnapshot !== null)
  const saleMovements = await findSaleMovementIds(
    tx,
    input.tenantId,
    candidates.map((l) => l.lineId),
  )

  const intents: MovementIntent[] = []
  const reversed: { lineId: string; qtyBase: Qty; valueBase: Money }[] = []
  for (const l of candidates) {
    const remaining = subQty(l.qtyBase, l.returnedQtyBase)
    if (cmpQty(remaining, ZERO_QTY) <= 0) continue
    const saleMovementId = saleMovements.get(l.lineId)
    if (!saleMovementId) continue
    const value = subMoney(l.costSnapshot!, l.returnedCost)
    intents.push({
      outletId: input.outletId,
      skuId: l.skuId!,
      kind: 'IN',
      qty: remaining,
      valueIn: value,
      costBasisHint: 'SNAPSHOT',
      movementType: 'SALE_VOID',
      sourceType: 'SALE_LINE',
      sourceId: l.lineId,
      occurredAt: input.occurredAt,
      businessDate: input.businessDate,
      reversesMovementId: saleMovementId,
      order: l.lineNo,
    })
    reversed.push({ lineId: l.lineId, qtyBase: remaining, valueBase: value })
  }
  if (intents.length > 0) {
    await applyMovements(
      tx,
      { tenantId: input.tenantId, commandId: input.commandId, actorId: input.actorId, processedAt: input.processedAt },
      intents,
    )
  }
  return { reversed }
}

/** Baris retur: HPP kembali hanya untuk disposisi KEMBALI_STOK (BR-HPP-007). */
export interface ReturnStockLine {
  readonly creditNoteLineId: string
  readonly lineNo: number
  readonly saleLineId: string
  readonly skuId: string | null
  readonly disposition: string | null
  readonly qtyReturnedBase: Qty
  /** Qty base baris penjualan asal. */
  readonly saleQtyBase: Qty
  readonly costSnapshot: Money | null
  /** Σ qty_returned_base KEMBALI_STOK sebelum retur ini. */
  readonly returnedQtyBefore: Qty
  /** Σ cost_returned sebelum retur ini. */
  readonly costReturnedBefore: Money
}

export interface ReturnStockInput {
  readonly tenantId: string
  readonly outletId: string
  readonly occurredAt: string
  readonly businessDate: string
  readonly processedAt: string
  readonly commandId: string | null
  readonly actorId: string | null
  readonly lines: readonly ReturnStockLine[]
}

/**
 * Menghitung `cost_returned` per baris retur dan membuat movement `RETURN_IN` untuk KEMBALI_STOK.
 * Retur yang melengkapi seluruh qty asal mengambil sisa HPP (kumulatif tidak melebihi snapshot).
 */
export async function applyReturnStock(
  tx: TenantTx,
  input: ReturnStockInput,
): Promise<{ readonly lines: readonly { creditNoteLineId: string; costReturned: Money | null }[] }> {
  const saleMovements = await findSaleMovementIds(
    tx,
    input.tenantId,
    input.lines.map((l) => l.saleLineId),
  )

  const intents: MovementIntent[] = []
  const out: { creditNoteLineId: string; costReturned: Money | null }[] = []
  for (const l of input.lines) {
    if (l.disposition !== 'KEMBALI_STOK' || l.costSnapshot === null || !l.skuId) {
      out.push({ creditNoteLineId: l.creditNoteLineId, costReturned: null })
      continue
    }
    const cumulative = addQty(l.returnedQtyBefore, l.qtyReturnedBase)
    const isFinal = cmpQty(cumulative, l.saleQtyBase) >= 0
    const costReturned = isFinal
      ? subMoney(l.costSnapshot, l.costReturnedBefore)
      : proRate(l.costSnapshot, l.qtyReturnedBase, l.saleQtyBase)
    out.push({ creditNoteLineId: l.creditNoteLineId, costReturned })

    const saleMovementId = saleMovements.get(l.saleLineId)
    intents.push({
      outletId: input.outletId,
      skuId: l.skuId,
      kind: 'IN',
      qty: l.qtyReturnedBase,
      valueIn: costReturned,
      costBasisHint: 'SNAPSHOT',
      movementType: 'RETURN_IN',
      sourceType: 'CREDIT_NOTE_LINE',
      sourceId: l.creditNoteLineId,
      occurredAt: input.occurredAt,
      businessDate: input.businessDate,
      reversesMovementId: saleMovementId ?? null,
      order: l.lineNo,
    })
  }
  if (intents.length > 0) {
    await applyMovements(
      tx,
      { tenantId: input.tenantId, commandId: input.commandId, actorId: input.actorId, processedAt: input.processedAt },
      intents,
    )
  }
  return { lines: out }
}


/** Saldo outlet untuk snapshot ke POS (dibaca oleh sync lewat port; BR-STK-005). */
export async function readOutletStockForSnapshot(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
): Promise<{ rows: { skuId: string; qty: string }[]; lastMovementAt: string | null; count: number }> {
  const res = await readOutletStockRows(tx, tenantId, outletId)
  return {
    rows: res.rows.map((r) => ({ skuId: r.skuId, qty: normalizeQty(r.qty as Qty) })),
    lastMovementAt: res.lastMovementAt,
    count: res.count,
  }
}
