import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator, normalizeQty, parseQty, toMoney, type Qty } from '~/lib/kernel'
import { applyMovements, type MovementIntent } from '~/modules/inventory/public'
import { closePools, withTenant } from '~/server/db'
import { setupInventoryTenant, type InventoryTenant } from './helpers/inventory'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

const PROCESSED = '2026-11-20T16:00:00.000Z'

function intent(t: InventoryTenant, p: Partial<MovementIntent> & Pick<MovementIntent, 'kind' | 'qty' | 'movementType' | 'sourceType' | 'order'>): MovementIntent {
  return {
    outletId: t.outletA,
    skuId: t.skuA,
    sourceId: idGen.newId(),
    occurredAt: '2026-11-20T14:00:00.000Z',
    businessDate: '2026-11-20',
    ...p,
  }
}

async function apply(t: InventoryTenant, intents: readonly MovementIntent[], processedAt = PROCESSED) {
  return withTenant(t.tenantId, (tx) =>
    applyMovements(tx, { tenantId: t.tenantId, actorId: t.actorUserId, processedAt }, intents),
  )
}

async function ledger(t: InventoryTenant, skuId: string) {
  return withTenant(t.tenantId, async (tx) => {
    const r = await tx.execute<{
      bal_seq: string
      qty_delta: string
      value_delta: string
      qty_after: string
      value_after: string
      cost_basis: string
      is_negative_result: boolean
    }>(sql`
      SELECT bal_seq::text, qty_delta::text, value_delta::text, qty_after::text, value_after::text, cost_basis, is_negative_result
      FROM stock_movement WHERE tenant_id = ${t.tenantId} AND sku_id = ${skuId}
      ORDER BY bal_seq`)
    // Kuantitas di DB berskala 4 ('100.0000'); bandingkan bentuk kanonik.
    return r.rows.map((x) => ({
      ...x,
      qty_delta: normalizeQty(x.qty_delta as Qty),
      qty_after: normalizeQty(x.qty_after as Qty),
    }))
  })
}

describe('inventory ledger apply (BR-STK-001, BR-HPP-003..005, V-12..V-14)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('V-12: sequence GR/sale/GR/sale/depleted gives an exact ledger and balance 0/0 (bal_seq 1..5, no gaps)', async () => {
    const t = await setupInventoryTenant('ledg-v12')
    const r = await apply(t, [
      intent(t, { kind: 'IN', qty: parseQty('100'), valueIn: toMoney(800000), movementType: 'GR_IN', sourceType: 'GR_LINE', order: 1 }),
      intent(t, { kind: 'OUT', qty: parseQty('30'), movementType: 'SALE', sourceType: 'SALE_LINE', order: 2 }),
      intent(t, { kind: 'IN', qty: parseQty('50'), valueIn: toMoney(425000), movementType: 'GR_IN', sourceType: 'GR_LINE', order: 3 }),
      intent(t, { kind: 'OUT', qty: parseQty('7'), movementType: 'SALE', sourceType: 'SALE_LINE', order: 4 }),
      intent(t, { kind: 'OUT', qty: parseQty('113'), movementType: 'SALE', sourceType: 'SALE_LINE', order: 5 }),
    ])
    expect(r.applied.every((a) => a.applied)).toBe(true)
    expect(r.applied.map((a) => a.valueDelta)).toEqual([800000, -240000, 425000, -57458, -927542])

    const rows = await ledger(t, t.skuA)
    expect(rows.map((x) => Number(x.bal_seq))).toEqual([1, 2, 3, 4, 5])
    expect(rows.map((x) => x.qty_after)).toEqual(['100', '70', '120', '113', '0'])
    expect(rows.map((x) => x.value_after)).toEqual(['800000', '560000', '985000', '927542', '0'])
    expect(rows.map((x) => x.cost_basis)).toEqual(['DECLARED', 'AVERAGE', 'DECLARED', 'AVERAGE', 'AVERAGE'])
    expect(r.negativeResults).toEqual([])
  })

  it('V-13: processed_at (16:00) dan occurred_at (14:00) tersimpan terpisah; HPP telat 82083 → 110/902917', async () => {
    const t = await setupInventoryTenant('ledg-v13')
    await apply(t, [intent(t, { kind: 'IN', qty: parseQty('70'), valueIn: toMoney(560000), movementType: 'GR_IN', sourceType: 'GR_LINE', order: 1 })], '2026-11-20T10:00:00.000Z')
    await apply(t, [intent(t, { kind: 'IN', qty: parseQty('50'), valueIn: toMoney(425000), movementType: 'GR_IN', sourceType: 'GR_LINE', order: 1 })], '2026-11-20T11:00:00.000Z')
    const r = await apply(t, [intent(t, { kind: 'OUT', qty: parseQty('10'), movementType: 'SALE', sourceType: 'SALE_LINE', order: 1 })], PROCESSED)
    expect(-r.applied[0]!.valueDelta).toBe(82083)
    const rows = await ledger(t, t.skuA)
    expect(rows[rows.length - 1]!.qty_after).toBe('110')
    expect(rows[rows.length - 1]!.value_after).toBe('902917')

    const stamps = await withTenant(t.tenantId, async (tx) => {
      const res = await tx.execute<{ occurred_at: string; processed_at: string }>(
        sql`SELECT occurred_at::text, processed_at::text FROM stock_movement WHERE tenant_id = ${t.tenantId} AND movement_type = 'SALE' LIMIT 1`,
      )
      return res.rows[0]!
    })
    expect(new Date(stamps.processed_at).getTime()).toBeGreaterThan(new Date(stamps.occurred_at).getTime())
  })

  it('V-14: negative stock MIXED (COGS 40000, balance −2/−16000) then GR 20@9000 → 18/164000; negative flag detected', async () => {
    const t = await setupInventoryTenant('ledg-v14')
    await apply(t, [intent(t, { kind: 'IN', qty: parseQty('3'), valueIn: toMoney(24000), movementType: 'GR_IN', sourceType: 'GR_LINE', order: 1 })])
    const r = await apply(t, [intent(t, { kind: 'OUT', qty: parseQty('5'), movementType: 'SALE', sourceType: 'SALE_LINE', order: 1 })])
    expect(-r.applied[0]!.valueDelta).toBe(40000)
    expect(r.applied[0]!.costBasis).toBe('MIXED')
    expect(r.negativeResults).toEqual([{ outletId: t.outletA, skuId: t.skuA, qtyAfter: '-2' }])

    await apply(t, [intent(t, { kind: 'IN', qty: parseQty('20'), valueIn: toMoney(180000), movementType: 'GR_IN', sourceType: 'GR_LINE', order: 1 })])
    const rows = await ledger(t, t.skuA)
    expect(rows[rows.length - 1]!.qty_after).toBe('18')
    expect(rows[rows.length - 1]!.value_after).toBe('164000')
  })

  it('idempotency: the same intent sent again adds no rows and changes no balance', async () => {
    const t = await setupInventoryTenant('ledg-idem')
    const gr = intent(t, { kind: 'IN', qty: parseQty('10'), valueIn: toMoney(10000), movementType: 'GR_IN', sourceType: 'GR_LINE', order: 1 })
    const sale = intent(t, { kind: 'OUT', qty: parseQty('4'), movementType: 'SALE', sourceType: 'SALE_LINE', order: 2 })
    const first = await apply(t, [gr, sale])
    const second = await apply(t, [gr, sale])
    expect(second.applied.every((a) => !a.applied)).toBe(true)
    expect(second.applied.map((a) => a.movementId)).toEqual(first.applied.map((a) => a.movementId))
    const rows = await ledger(t, t.skuA)
    expect(rows.length).toBe(2)
    expect(rows[1]!.qty_after).toBe('6')
  })

  it('several SKUs in one call: (outlet, sku) key order holds and each balance is correct', async () => {
    const t = await setupInventoryTenant('ledg-multi')
    const r = await apply(t, [
      intent(t, { kind: 'IN', qty: parseQty('5'), valueIn: toMoney(50000), movementType: 'GR_IN', sourceType: 'GR_LINE', order: 1, skuId: t.skuB }),
      intent(t, { kind: 'IN', qty: parseQty('2'), valueIn: toMoney(4000), movementType: 'GR_IN', sourceType: 'GR_LINE', order: 2 }),
      intent(t, { kind: 'OUT', qty: parseQty('1'), movementType: 'SALE', sourceType: 'SALE_LINE', order: 3, skuId: t.skuB }),
    ])
    expect(r.applied.length).toBe(3)
    const b = await ledger(t, t.skuB)
    expect(b[b.length - 1]!.qty_after).toBe('4')
    expect(b[b.length - 1]!.value_after).toBe('40000')
  })

  it('duplicate intents in one call are rejected', async () => {
    const t = await setupInventoryTenant('ledg-dup')
    const sid = idGen.newId()
    const a = intent(t, { kind: 'IN', qty: parseQty('1'), valueIn: toMoney(1000), movementType: 'GR_IN', sourceType: 'GR_LINE', sourceId: sid, order: 1 })
    await expect(apply(t, [a, { ...a, order: 2 }])).rejects.toThrow(/duplikat/)
  })
})
