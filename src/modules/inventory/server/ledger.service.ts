import '@tanstack/react-start/server-only'
import { webcrypto } from 'node:crypto'
import { createIdGenerator, cmpQty, isUuid, parseQty, toMoney, type Money, type Qty } from '~/lib/kernel'
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
  updateBalance,
  type BalanceKey,
  type MovementInsert,
} from './ledger.repo'

const ledgerIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

/**
 * Niat satu perubahan stok (SCHEMA §4.3.3). `kind`:
 * - `OUT`: keluar `qty` (positif) → HPP (AVERAGE/MIXED/REFERENCE);
 * - `IN`: masuk `qty` (positif) dengan `valueIn` dan basis (`costBasisHint`, default DECLARED);
 * - `IN_REF`: masuk pada biaya referensi (retur saat saldo ≤ 0, BR-HPP-005);
 * - `ADJUST`: penyesuaian bertanda `qty` (≠ 0).
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
  /** Urutan pemrosesan dalam satu panggilan (pemanggil memberi nomor; lihat AD-22). */
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
  /** `false` bila intent ini sudah pernah diterapkan (idempoten: hasil yang ada dikembalikan). */
  readonly applied: boolean
}

export interface ApplyContext {
  readonly tenantId: string
  readonly commandId?: string | null
  readonly actorId?: string | null
  /** Waktu server saat diproses (`processed_at`; acuan biaya). Disuntik, tidak dibaca dari jam. */
  readonly processedAt: string
}

export interface ApplyResult {
  readonly applied: readonly AppliedMovement[]
  /** Kunci saldo yang berakhir negatif (pemanggil membuat flag STOK_MINUS). */
  readonly negativeResults: readonly { outletId: string; skuId: string; qtyAfter: Qty }[]
}

function intentKey(i: MovementIntent): string {
  return `${i.sourceType}|${i.sourceId}|${i.skuId}|${i.movementType}`
}

function validateIntent(i: MovementIntent): void {
  if (!isUuid(i.outletId) || !isUuid(i.skuId) || !isUuid(i.sourceId)) {
    throw new RangeError('movement intent: outletId, skuId, sourceId harus UUID')
  }
  if (!(MOVEMENT_TYPES as readonly string[]).includes(i.movementType)) {
    throw new RangeError(`movement intent: movementType tidak dikenal: ${i.movementType}`)
  }
  if (!(STOCK_SOURCE_TYPES as readonly string[]).includes(i.sourceType)) {
    throw new RangeError(`movement intent: sourceType tidak dikenal: ${i.sourceType}`)
  }
  const sign = cmpQty(i.qty, parseQty('0'))
  if (i.kind === 'ADJUST') {
    if (sign === 0) throw new RangeError('movement intent ADJUST: qty tidak boleh nol')
  } else if (sign <= 0) {
    throw new RangeError(`movement intent ${i.kind}: qty harus positif`)
  }
  if ((i.kind === 'IN' || i.kind === 'OUT_VALUE') && i.valueIn === undefined) {
    throw new RangeError(`movement intent ${i.kind}: valueIn wajib`)
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
 * Menerapkan daftar niat stok secara atomik di dalam transaksi pemanggil (BR-STK-001, AD-22):
 * 1. validasi; 2. kunci saldo `FOR UPDATE` berurutan (outlet_id, sku_id);
 * 3. idempotensi per (sumber, SKU, jenis) — yang sudah ada tidak dihitung ulang;
 * 4. terapkan berurutan `order` memakai `costing`, tulis ledger set-based, lalu satu UPDATE per kunci.
 * Tidak mengambil lock `audit_chain_head` (milik pemanggil) dan tidak menyentuh device.
 */
export async function applyMovements(
  tx: TenantTx,
  ctx: ApplyContext,
  intents: readonly MovementIntent[],
): Promise<ApplyResult> {
  for (const i of intents) validateIntent(i)
  if (intents.length === 0) return { applied: [], negativeResults: [] }

  const ordered = [...intents].sort((a, b) => a.order - b.order)

  // Kunci unik (outlet, sku) terurut.
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

  // Idempotensi: intent yang sudah ada dilewati (hasil lama dikembalikan).
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
    if (!current) throw new Error(`saldo tidak terkunci untuk ${key}`)
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

  for (const k of keys) {
    const key = `${k.outletId}|${k.skuId}`
    const s = state.get(key)
    if (!s) continue
    const before = locked.find((r) => r.outletId === k.outletId && r.skuId === k.skuId)
    if (before && before.rev === s.rev) continue // tidak ada movement baru untuk kunci ini
    await updateBalance(tx, ctx.tenantId, k, {
      qty: s.qty,
      inventoryValue: s.inventoryValue,
      refValue: s.refValue,
      refQty: s.refQty,
      rev: s.rev,
      lastMovementAt: touchedAt.get(key) ?? ctx.processedAt,
      updatedAt: ctx.processedAt,
    })
  }

  return { applied, negativeResults }
}

function negate(q: Qty): Qty {
  return parseQty(q.startsWith('-') ? q.slice(1) : `-${q}`)
}
