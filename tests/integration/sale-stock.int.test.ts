import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator, normalizeQty, parseQty, toMoney, type Qty } from '~/lib/kernel'
import { applyMovements, applySaleStock } from '~/modules/inventory/public'
import { closePools, withTenant } from '~/server/db'
import {
  enableOutletInventory,
  disableOutletInventory,
  setSkuProductFlags,
  setupInventoryTenant,
  type InventoryTenant,
} from './helpers/inventory'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

const ENABLED_AT = '2026-11-01T00:00:00.000Z'

async function receive(t: InventoryTenant, skuId: string, qty: string, value: number, at = '2026-11-20T15:00:00.000Z') {
  await withTenant(t.tenantId, (tx) =>
    applyMovements(tx, { tenantId: t.tenantId, processedAt: at }, [
      {
        outletId: t.outletA,
        skuId,
        kind: 'IN',
        qty: parseQty(qty),
        valueIn: toMoney(value),
        movementType: 'GR_IN',
        sourceType: 'GR_LINE',
        sourceId: idGen.newId(),
        occurredAt: at,
        businessDate: '2026-11-20',
        order: 1,
      },
    ]),
  )
}

async function sell(t: InventoryTenant, skuId: string, qty: string, processedAt: string, occurredAt = '2026-11-20T14:00:00.000Z') {
  const lineId = idGen.newId()
  const res = await withTenant(t.tenantId, (tx) =>
    applySaleStock(tx, {
      tenantId: t.tenantId,
      outletId: t.outletA,
      saleId: idGen.newId(),
      occurredAt,
      businessDate: '2026-11-20',
      processedAt,
      commandId: null,
      actorId: t.actorUserId,
      lines: [{ lineId, lineNo: 1, lineKind: 'ITEM', skuId, qtyBase: parseQty(qty) }],
    }),
  )
  return { res, lineId }
}

async function balance(t: InventoryTenant, skuId: string) {
  return withTenant(t.tenantId, async (tx) => {
    const r = await tx.execute<{ qty: string; inventory_value: string }>(sql`
      SELECT qty::text, inventory_value::text FROM stock_balance
      WHERE tenant_id = ${t.tenantId} AND outlet_id = ${t.outletA} AND sku_id = ${skuId}`)
    const row = r.rows[0]
    return row ? { qty: normalizeQty(row.qty as Qty), value: Number(row.inventory_value) } : null
  })
}

async function movementCount(t: InventoryTenant, skuId: string): Promise<number> {
  return withTenant(t.tenantId, async (tx) => {
    const r = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM stock_movement WHERE tenant_id = ${t.tenantId} AND sku_id = ${skuId}`)
    return Number(r.rows[0]!.n)
  })
}

describe('sale stock integration (BR-STK-002..004, BR-HPP-004/005, V-13, V-14, V-28)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('V-13 end-to-end: saldo 70/560000, GR 15:00, jual 10 (occurred 14:00, processed 16:00) → cost 82083 dan saldo 110/902917', async () => {
    const t = await setupInventoryTenant('ss-v13')
    await enableOutletInventory(t.tenantId, t.outletA, ENABLED_AT)
    await receive(t, t.skuA, '70', 560000, '2026-11-20T09:00:00.000Z')
    await receive(t, t.skuA, '50', 425000, '2026-11-20T15:00:00.000Z')
    const { res, lineId } = await sell(t, t.skuA, '10', '2026-11-20T16:00:00.000Z')
    expect(res.costTotal).toBe(82083)
    expect(res.lines[0]!.lineId).toBe(lineId)
    expect(res.lines[0]!.costSnapshot).toBe(82083)
    expect(await balance(t, t.skuA)).toEqual({ qty: '110', value: 902917 })
  })

  it('V-14 end-to-end: saldo 3/24000 jual 5 → HPP 40000, saldo −2/−16000, flag negatif; replay tidak menggandakan; GR 20@9000 → 18/164000', async () => {
    const t = await setupInventoryTenant('ss-v14')
    await enableOutletInventory(t.tenantId, t.outletA, ENABLED_AT)
    await receive(t, t.skuA, '3', 24000)
    const lineId = idGen.newId()
    const input = {
      tenantId: t.tenantId,
      outletId: t.outletA,
      saleId: idGen.newId(),
      occurredAt: '2026-11-20T14:00:00.000Z',
      businessDate: '2026-11-20',
      processedAt: '2026-11-20T16:00:00.000Z',
      commandId: null,
      actorId: t.actorUserId,
      lines: [{ lineId, lineNo: 1, lineKind: 'ITEM' as const, skuId: t.skuA, qtyBase: parseQty('5') }],
    }
    const first = await withTenant(t.tenantId, (tx) => applySaleStock(tx, input))
    expect(first.costTotal).toBe(40000)
    expect(first.negativeResults).toEqual([{ outletId: t.outletA, skuId: t.skuA, qtyAfter: '-2' }])
    expect(await balance(t, t.skuA)).toEqual({ qty: '-2', value: -16000 })

    const replay = await withTenant(t.tenantId, (tx) => applySaleStock(tx, input))
    expect(replay.costTotal).toBe(40000)
    expect(replay.negativeResults).toEqual([])
    expect(await movementCount(t, t.skuA)).toBe(2)

    await receive(t, t.skuA, '20', 180000, '2026-11-20T17:00:00.000Z')
    expect(await balance(t, t.skuA)).toEqual({ qty: '18', value: 164000 })
  })

  it('V-28 (stok): saldo 1/40000, jual 2 (occurred 14:00, diterima 15:05) → cost 80000, saldo −1/−40000 MIXED negatif', async () => {
    const t = await setupInventoryTenant('ss-v28')
    await enableOutletInventory(t.tenantId, t.outletA, ENABLED_AT)
    await receive(t, t.skuA, '1', 40000)
    const { res } = await sell(t, t.skuA, '2', '2026-11-20T15:05:00.000Z', '2026-11-20T14:00:00.000Z')
    expect(res.costTotal).toBe(80000)
    expect(res.negativeResults.length).toBe(1)
    expect(await balance(t, t.skuA)).toEqual({ qty: '-1', value: -40000 })
    const basis = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ cost_basis: string }>(sql`
        SELECT cost_basis FROM stock_movement WHERE tenant_id = ${t.tenantId} AND sku_id = ${t.skuA}
        ORDER BY bal_seq DESC LIMIT 1`)
      return r.rows[0]!.cost_basis
    })
    expect(basis).toBe('MIXED')
  })

  it('aktivasi (BR-STK-004): outlet belum aktif atau penjualan diproses sebelum aktivasi → tanpa movement dan cost NULL', async () => {
    const t = await setupInventoryTenant('ss-act')
    await receive(t, t.skuA, '5', 5000)
    const before = await sell(t, t.skuA, '1', '2026-11-20T16:00:00.000Z')
    expect(before.res.costTotal).toBeNull()
    expect(before.res.lines[0]!.costSnapshot).toBeNull()

    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-20T12:00:00.000Z')
    const earlyProcessed = await sell(t, t.skuA, '1', '2026-11-20T11:00:00.000Z')
    expect(earlyProcessed.res.costTotal).toBeNull()
    expect(await movementCount(t, t.skuA)).toBe(1) // hanya GR awal

    const after = await sell(t, t.skuA, '1', '2026-11-20T13:00:00.000Z')
    expect(after.res.costTotal).toBe(1000)
    await disableOutletInventory(t.tenantId, t.outletA)
  })

  it('track_stock=false dan produk MENU_FNB dilewati (tanpa movement)', async () => {
    const t = await setupInventoryTenant('ss-flags')
    await enableOutletInventory(t.tenantId, t.outletA, ENABLED_AT)
    await receive(t, t.skuA, '5', 5000)
    const baseline = await movementCount(t, t.skuA)

    await setSkuProductFlags(t.tenantId, t.skuA, { trackStock: false })
    const untracked = await sell(t, t.skuA, '1', '2026-11-20T16:00:00.000Z')
    expect(untracked.res.costTotal).toBeNull()

    await setSkuProductFlags(t.tenantId, t.skuA, { trackStock: true, productType: 'MENU_FNB' })
    const fnb = await sell(t, t.skuA, '1', '2026-11-20T16:00:00.000Z')
    expect(fnb.res.costTotal).toBeNull()
    expect(await movementCount(t, t.skuA)).toBe(baseline)
  })
})
