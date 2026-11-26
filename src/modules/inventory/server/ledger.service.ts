import '@tanstack/react-start/server-only'
import { cmpQty, isUuid, parseQty, toMoney, type Money, type Qty } from '~/lib/kernel'
import { runtimeIdGenerator as ledgerIdGen } from '~/lib/runtime-id'
import type { TenantTx } from '~/server/db'
import {
  applyAdjustment,
  applyIn,
  applyInAtReference,
  applyOut,
  applyReversalAtValue,
  type CostBasis,
  type CostResult,
  type StockBalance,
} from '../domain/costing'
import { MOVEMENT_TYPES, STOCK_SOURCE_TYPES, type MovementType, type StockSourceType } from '../domain/movement-types'
import {
  ensureBalanceRows,
  findExistingMovements,
  insertMovements,
  lockBalancesOrdered,
  setLedgerLockTimeout,
  updateBalances,
  type BalanceKey,
  type BalanceUpdate,
  type MovementInsert,
} from './ledger.repo'

/**
 * One stock change intent (SCHEMA §4.3.3). `kind`:
 * - `OUT`: outgoing `qty` (positive) → COGS (AVERAGE/MIXED/REFERENCE);
 * - `IN`: incoming `qty` (positive) with `valueIn` and basis (`costBasisHint`, default DECLARED);
 * - `IN_REF`: incoming at the reference cost (return when balance ≤ 0, BR-HPP-005);
 * - `ADJUST`: signed adjustment `qty` (≠ 0).
 */
export interface MovementIntent {
  readonly outletId: string
  readonly skuId: string
  readonly kind: 'OUT' | 'OUT_VALUE' | 'IN' | 'IN_REF' | 'ADJUST'
  readonly qty: Qty
  readonly valueIn?: Money
  readonly costBasisHint?: 'DECLARED' | 'TRANSFER' | 'SNAPSHOT'
  readonly movementType: MovementType
  readonly sourceType: StockSourceType
  readonly sourceId: string
  readonly occurredAt: string
  readonly businessDate: string
  readonly reversesMovementId?: string | null
  /** Processing order within one call (the caller assigns the numbers; see AD-22). */
  readonly order: number
}

export interface AppliedMovement {
  readonly movementId: string
  readonly sourceId: string
  readonly outletId: string
  readonly skuId: string
  readonly movementType: MovementType
  readonly valueDelta: Money
  readonly costBasis: CostBasis
  readonly isNegativeResult: boolean
  readonly balSeq: number
  /** `false` when this intent was already applied (idempotent: the existing result is returned). */
  readonly applied: boolean
}

export interface ApplyContext {
  readonly tenantId: string
  readonly commandId?: string | null
  readonly actorId?: string | null
  /** Server time at processing (`processed_at`; cost reference). Injected, not read from the clock. */
  readonly processedAt: string
}

export interface ApplyResult {
  readonly applied: readonly AppliedMovement[]
  /** Balance keys that end up negative (the caller creates STOK_MINUS flags). */
  readonly negativeResults: readonly { outletId: string; skuId: string; qtyAfter: Qty }[]
}

function intentKey(i: MovementIntent): string {
  return `${i.sourceType}|${i.sourceId}|${i.skuId}|${i.movementType}`
}

function validateIntent(i: MovementIntent): void {
  if (!isUuid(i.outletId) || !isUuid(i.skuId) || !isUuid(i.sourceId)) {
    throw new RangeError('movement intent: outletId, skuId and sourceId must be UUIDs')
  }
  if (!(MOVEMENT_TYPES as readonly string[]).includes(i.movementType)) {
    throw new RangeError(`movement intent: unknown movementType: ${i.movementType}`)
  }
  if (!(STOCK_SOURCE_TYPES as readonly string[]).includes(i.sourceType)) {
    throw new RangeError(`movement intent: unknown sourceType: ${i.sourceType}`)
  }
  const sign = cmpQty(i.qty, parseQty('0'))
  if (i.kind === 'ADJUST') {
    if (sign === 0) throw new RangeError('movement intent ADJUST: qty must not be zero')
  } else if (sign <= 0) {
    throw new RangeError(`movement intent ${i.kind}: qty must be positive`)
  }
  if ((i.kind === 'IN' || i.kind === 'OUT_VALUE') && i.valueIn === undefined) {
    throw new RangeError(`movement intent ${i.kind}: valueIn is required`)
  }
}

function applyOne(balance: StockBalance, i: MovementIntent): CostResult {
  switch (i.kind) {
    case 'OUT':
      return applyOut(balance, i.qty)
    case 'OUT_VALUE':
      return applyReversalAtValue(balance, i.qty, i.valueIn ?? toMoney(0))
    case 'IN':
      return applyIn(balance, i.qty, i.valueIn ?? toMoney(0), i.costBasisHint ?? 'DECLARED')
    case 'IN_REF':
      return applyInAtReference(balance, i.qty)
    case 'ADJUST':
      return applyAdjustment(balance, i.qty)
  }
}

/**
 * Applies a list of stock intents atomically inside the caller's transaction (BR-STK-001, AD-22):
 * 1. validation; 2. lock balances `FOR UPDATE` in order (outlet_id, sku_id);
 * 3. idempotency per (source, SKU, type) — existing intents are not recalculated;
 * 4. apply in `order` using `costing`, write the ledger set-based, then one UPDATE per key.
 * Does not take the `audit_chain_head` lock (that belongs to the caller) and does not touch devices.
 */
export async function applyMovements(
  tx: TenantTx,
  ctx: ApplyContext,
  intents: readonly MovementIntent[],
): Promise<ApplyResult> {
  for (const i of intents) validateIntent(i)
  if (intents.length === 0) return { applied: [], negativeResults: [] }

  const ordered = [...intents].sort((a, b) => a.order - b.order)

  // Unique (outlet, sku) keys, sorted.
  const keyMap = new Map<string, BalanceKey>()
  for (const i of ordered) {
    keyMap.set(`${i.outletId}|${i.skuId}`, { outletId: i.outletId, skuId: i.skuId })
  }
  const keys = [...keyMap.values()].sort((a, b) =>
    a.outletId === b.outletId ? (a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0) : a.outletId < b.outletId ? -1 : 1,
  )

  await setLedgerLockTimeout(tx)
  await ensureBalanceRows(tx, ctx.tenantId, keys)
  const locked = await lockBalancesOrdered(tx, ctx.tenantId, keys)

  // Idempotency: intents that already exist are skipped (the previous result is returned).
  const existing = await findExistingMovements(
    tx,
    ctx.tenantId,
    ordered.map((i) => ({ sourceType: i.sourceType, sourceId: i.sourceId, skuId: i.skuId, movementType: i.movementType })),
  )

  const state = new Map<string, StockBalance>()
  for (const row of locked) {
    state.set(`${row.outletId}|${row.skuId}`, {
      qty: parseQty(row.qty),
      inventoryValue: toMoney(row.inventoryValue),
      refValue: toMoney(row.refValue),
      refQty: parseQty(row.refQty),
      rev: row.rev,
    })
  }

  const inserts: MovementInsert[] = []
  const applied: AppliedMovement[] = []
  const negativeResults: { outletId: string; skuId: string; qtyAfter: Qty }[] = []
  const touchedAt = new Map<string, string>()
  const seenInBatch = new Set<string>()

  for (const i of ordered) {
    const key = `${i.outletId}|${i.skuId}`
    const prior = existing.get(intentKey(i))
    if (prior) {
      applied.push({
        movementId: prior.id,
        sourceId: i.sourceId,
        outletId: i.outletId,
        skuId: i.skuId,
        movementType: i.movementType,
        valueDelta: toMoney(prior.valueDelta),
        costBasis: prior.costBasis as CostBasis,
        isNegativeResult: false,
        balSeq: prior.balSeq,
        applied: false,
      })
      continue
    }
    const ikey = intentKey(i)
    if (seenInBatch.has(ikey)) {
      throw new RangeError(`movement intent duplikat dalam satu panggilan: ${ikey}`)
    }
    seenInBatch.add(ikey)

    const current = state.get(key)
    if (!current) throw new Error(`balance row was not locked for ${key}`)
    const result = applyOne(current, i)
    const balSeq = current.rev + 1
    const next: StockBalance = { ...result.next, rev: balSeq }
    state.set(key, next)
    touchedAt.set(key, ctx.processedAt)

    const movementId = ledgerIdGen.newId()
    inserts.push({
      id: movementId,
      tenantId: ctx.tenantId,
      outletId: i.outletId,
      skuId: i.skuId,
      processedAt: ctx.processedAt,
      occurredAt: i.occurredAt,
      businessDate: i.businessDate,
      movementType: i.movementType,
      qtyDelta: i.kind === 'OUT' || i.kind === 'OUT_VALUE' ? negate(i.qty) : i.qty,
      valueDelta: result.valueDelta,
      qtyAfter: result.next.qty,
      valueAfter: result.next.inventoryValue,
      balSeq,
      costBasis: result.costBasis,
      isNegativeResult: result.isNegativeResult,
      sourceType: i.sourceType,
      sourceId: i.sourceId,
      reversesMovementId: i.reversesMovementId ?? null,
      commandId: ctx.commandId ?? null,
      createdBy: ctx.actorId ?? null,
    })
    applied.push({
      movementId,
      sourceId: i.sourceId,
      outletId: i.outletId,
      skuId: i.skuId,
      movementType: i.movementType,
      valueDelta: result.valueDelta,
      costBasis: result.costBasis,
      isNegativeResult: result.isNegativeResult,
      balSeq,
      applied: true,
    })
    if (result.isNegativeResult) {
      negativeResults.push({ outletId: i.outletId, skuId: i.skuId, qtyAfter: result.next.qty })
    }
  }

  await insertMovements(tx, inserts)

  const lockedByKey = new Map<string, (typeof locked)[number]>(
    locked.map((r) => [`${r.outletId}|${r.skuId}`, r] as const),
  )
  const balanceUpdates: BalanceUpdate[] = []
  for (const k of keys) {
    const key = `${k.outletId}|${k.skuId}`
    const s = state.get(key)
    if (!s) continue
    const before = lockedByKey.get(key)
    if (before && before.rev === s.rev) continue // no new movement for this key
    balanceUpdates.push({
      key: k,
      next: {
        qty: s.qty,
        inventoryValue: s.inventoryValue,
        refValue: s.refValue,
        refQty: s.refQty,
        rev: s.rev,
        lastMovementAt: touchedAt.get(key) ?? ctx.processedAt,
        updatedAt: ctx.processedAt,
      },
    })
  }
  await updateBalances(tx, ctx.tenantId, balanceUpdates)

  return { applied, negativeResults }
}

function negate(q: Qty): Qty {
  return parseQty(q.startsWith('-') ? q.slice(1) : `-${q}`)
}
