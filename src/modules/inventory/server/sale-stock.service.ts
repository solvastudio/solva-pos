import '@tanstack/react-start/server-only'
import { addQty, cmpQty, normalizeQty, parseQty, proRate, subMoney, subQty, toMoney, type Money, type Qty } from '~/lib/kernel'
import { getModifierIngredients, getRecipeFor, getSkuProductTypes } from '~/modules/catalog/public'
import type { TenantTx } from '~/server/db'
import { createLogger } from '~/server/log'
import { ZERO_QTY } from '../domain/costing'
import { applyMovements, type MovementIntent } from './ledger.service'
import { buildRecipeIntents } from './recipe-consumption.service'
import {
  findAllSaleMovements,
  findSaleMovementIds,
  loadInventoryEnabledAt,
  readOutletStockRows,
  type SaleOriginMovementRow,
} from './sale-stock.repo'

const log = createLogger('inventory.sale_stock')

/**
 * Sales stock integration: the authoritative COGS is computed by the server while processing (BR-HPP-004).
 * Never rejects a transaction for stock reasons (AP-02); negative balances are only flagged.
 */

export interface SaleStockLine {
  readonly lineId: string
  readonly lineNo: number
  readonly lineKind: 'ITEM' | 'SHARE' | 'STOCK_BASIS'
  readonly skuId: string | null
  readonly qtyBase: Qty
  readonly modifiers?: readonly { readonly modifierId: string | null; readonly qty: number }[]
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
  /** Sum of tracked line COGS; `null` when no line is tracked (BR-STK-004). */
  readonly costTotal: Money | null
  readonly lines: readonly { readonly lineId: string; readonly costSnapshot: Money | null }[]
  readonly negativeResults: readonly { readonly outletId: string; readonly skuId: string; readonly qtyAfter: Qty }[]
  readonly missingRecipeLineIds: readonly string[]
}

function noStock(lines: readonly SaleStockLine[]): SaleStockResult {
  return {
    costTotal: null,
    lines: lines.map((l) => ({ lineId: l.lineId, costSnapshot: null })),
    negativeResults: [],
    missingRecipeLineIds: [],
  }
}

/**
 * Writes a `SALE` movement per tracked retail ITEM line and `RECIPE_CONSUMPTION` per ingredient
 * for tracked `MENU_FNB` lines, returning `cost_snapshot` per line (BR-HPP-004/006, BR-RCP-003..006).
 */
export async function applySaleStock(tx: TenantTx, input: SaleStockInput): Promise<SaleStockResult> {
  const enabledAt = await loadInventoryEnabledAt(tx, input.tenantId, input.outletId)
  if (!enabledAt || Date.parse(input.processedAt) < Date.parse(enabledAt)) {
    return noStock(input.lines)
  }

  const itemLines = input.lines.filter(
    (l) => (l.lineKind === 'ITEM' || l.lineKind === 'STOCK_BASIS') && l.skuId,
  )
  const skuIds = [...new Set(itemLines.map((l) => l.skuId!))]
  if (skuIds.length === 0) {
    return noStock(input.lines)
  }

  const skuTypes = await getSkuProductTypes(tx, input.tenantId, skuIds)
  const retailIntents: MovementIntent[] = []
  const menuSkuIds: string[] = []
  const modifierIds: string[] = []

  for (const l of itemLines) {
    const meta = skuTypes.get(l.skuId!)
    if (!meta || !meta.trackStock) continue
    if (meta.productType === 'RETAIL') {
      retailIntents.push({
        outletId: input.outletId,
        skuId: l.skuId!,
        kind: 'OUT',
        qty: l.qtyBase,
        movementType: 'SALE',
        sourceType: 'SALE_LINE',
        sourceId: l.lineId,
        occurredAt: input.occurredAt,
        businessDate: input.businessDate,
        order: l.lineNo * 1000,
      })
    } else if (meta.productType === 'MENU_FNB') {
      menuSkuIds.push(l.skuId!)
      for (const m of l.modifiers ?? []) {
        if (m.modifierId) modifierIds.push(m.modifierId)
      }
    }
  }

  const recipesByMenuSku =
    menuSkuIds.length > 0 ? await getRecipeFor(tx, input.tenantId, menuSkuIds) : new Map()
  const modifierIngredientsByModifier =
    modifierIds.length > 0 ? await getModifierIngredients(tx, input.tenantId, modifierIds) : new Map()

  const recipeBuilt = buildRecipeIntents({
    outletId: input.outletId,
    occurredAt: input.occurredAt,
    businessDate: input.businessDate,
    lines: itemLines,
    skuTypes,
    recipesByMenuSku,
    modifierIngredientsByModifier,
  })

  const intents: MovementIntent[] = [...retailIntents, ...recipeBuilt.intents]
  const recipeMenuSet = new Set(recipeBuilt.recipeMenuLineIds)

  if (intents.length === 0) {
    return {
      costTotal: recipeMenuSet.size > 0 ? toMoney(0) : null,
      lines: input.lines.map((l) => ({
        lineId: l.lineId,
        costSnapshot: recipeMenuSet.has(l.lineId) ? toMoney(0) : null,
      })),
      negativeResults: [],
      missingRecipeLineIds: recipeBuilt.missingRecipeLineIds,
    }
  }

  const result = await applyMovements(
    tx,
    { tenantId: input.tenantId, commandId: input.commandId, actorId: input.actorId, processedAt: input.processedAt },
    intents,
  )

  const costByLine = new Map<string, number>()
  for (const a of result.applied) {
    costByLine.set(a.sourceId, (costByLine.get(a.sourceId) ?? 0) - a.valueDelta)
  }

  let total = 0
  let hasCostedLine = false
  const lines = input.lines.map((l) => {
    const raw = costByLine.get(l.lineId)
    const cost = raw !== undefined ? toMoney(raw) : recipeMenuSet.has(l.lineId) ? toMoney(0) : null
    if (cost !== null) {
      total += cost
      hasCostedLine = true
    }
    return { lineId: l.lineId, costSnapshot: cost }
  })

  return {
    costTotal: hasCostedLine ? toMoney(total) : null,
    lines,
    negativeResults: result.negativeResults,
    missingRecipeLineIds: recipeBuilt.missingRecipeLineIds,
  }
}

/** Void line: original COGS minus the portion already returned to stock (BR-HPP-007). */
export interface VoidStockLine {
  readonly lineId: string
  readonly lineNo: number
  readonly skuId: string | null
  readonly qtyBase: Qty
  /** `cost_snapshot` of the sale line; `null` when the line has no movement. */
  readonly costSnapshot: Money | null
  /** Σ qty_returned_base for earlier `KEMBALI_STOK` returns. */
  readonly returnedQtyBase: Qty
  /** Σ cost_returned for earlier returns. */
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

/** Reverses `SALE` and `RECIPE_CONSUMPTION` movements with `SALE_VOID` at snapshot cost (idempotent per line/SKU). */
export async function applyVoidStock(
  tx: TenantTx,
  input: VoidStockInput,
): Promise<{ readonly reversed: readonly { lineId: string; qtyBase: Qty; valueBase: Money }[] }> {
  const candidates = input.lines.filter((l) => l.skuId !== null && l.costSnapshot !== null)
  const originMovements = await findAllSaleMovements(
    tx,
    input.tenantId,
    candidates.map((l) => l.lineId),
  )

  const movementsByLine = new Map<string, SaleOriginMovementRow[]>()
  for (const m of originMovements) {
    let list = movementsByLine.get(m.sourceId)
    if (!list) {
      list = []
      movementsByLine.set(m.sourceId, list)
    }
    list.push(m)
  }

  const intents: MovementIntent[] = []
  const reversed: { lineId: string; qtyBase: Qty; valueBase: Money }[] = []
  for (const l of candidates) {
    const lineMovements = movementsByLine.get(l.lineId) ?? []
    const recipeMovements = lineMovements.filter((m) => m.movementType === 'RECIPE_CONSUMPTION')

    if (recipeMovements.length > 0) {
      let totalReversedValue = 0
      const sortedRecipe = [...recipeMovements].sort((a, b) => (a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0))
      for (let idx = 0; idx < sortedRecipe.length; idx += 1) {
        const rm = sortedRecipe[idx]!
        const qtyStr = rm.qtyDelta.startsWith('-') ? rm.qtyDelta.slice(1) : rm.qtyDelta
        const revQty = parseQty(qtyStr)
        const revVal = toMoney(-rm.valueDelta)
        totalReversedValue += revVal
        intents.push({
          outletId: input.outletId,
          skuId: rm.skuId,
          kind: 'IN',
          qty: revQty,
          valueIn: revVal,
          costBasisHint: 'SNAPSHOT',
          movementType: 'SALE_VOID',
          sourceType: 'SALE_LINE',
          sourceId: l.lineId,
          occurredAt: input.occurredAt,
          businessDate: input.businessDate,
          reversesMovementId: rm.id,
          order: l.lineNo * 1000 + idx + 1,
        })
      }
      reversed.push({ lineId: l.lineId, qtyBase: l.qtyBase, valueBase: toMoney(totalReversedValue) })
      continue
    }

    const saleMov = lineMovements.find((m) => m.movementType === 'SALE')
    if (!saleMov) continue
    const remaining = subQty(l.qtyBase, l.returnedQtyBase)
    if (cmpQty(remaining, ZERO_QTY) <= 0) continue
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
      reversesMovementId: saleMov.id,
      order: l.lineNo * 1000,
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

/** Return line: COGS returned only for the KEMBALI_STOK disposition (BR-HPP-007). */
export interface ReturnStockLine {
  readonly creditNoteLineId: string
  readonly lineNo: number
  readonly saleLineId: string
  readonly skuId: string | null
  readonly disposition: string | null
  readonly qtyReturnedBase: Qty
  /** Base qty of the original sale line. */
  readonly saleQtyBase: Qty
  readonly costSnapshot: Money | null
  /** Σ qty_returned_base for KEMBALI_STOK before this return. */
  readonly returnedQtyBefore: Qty
  /** Σ cost_returned before this return. */
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
 * Computes `cost_returned` per return line and creates a `RETURN_IN` movement for KEMBALI_STOK.
 * A return that completes the original quantity takes the remaining COGS (the cumulative value never exceeds the snapshot).
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
  const returnSkuIds = input.lines
    .filter((l) => l.disposition === 'KEMBALI_STOK' && l.skuId !== null)
    .map((l) => l.skuId!)
  const skuTypes =
    returnSkuIds.length > 0 ? await getSkuProductTypes(tx, input.tenantId, returnSkuIds) : new Map()

  const intents: MovementIntent[] = []
  const out: { creditNoteLineId: string; costReturned: Money | null }[] = []
  for (const l of input.lines) {
    if (l.disposition !== 'KEMBALI_STOK' || l.costSnapshot === null || !l.skuId) {
      out.push({ creditNoteLineId: l.creditNoteLineId, costReturned: null })
      continue
    }
    if (skuTypes.get(l.skuId)?.productType === 'MENU_FNB') {
      log.warn(
        { reason: 'menu_return_kembali_stok_ignored' },
        'KEMBALI_STOK return on MENU_FNB item does not restore recipe ingredients',
      )
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


/** Outlet balance for the POS snapshot (read by sync through the port; BR-STK-005). */
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
