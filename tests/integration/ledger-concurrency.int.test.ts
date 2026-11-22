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

function sale(t: InventoryTenant, skuId: string, qty: string, order = 1): MovementIntent {
  return {
    outletId: t.outletA,
    skuId,
    kind: 'OUT',
    qty: parseQty(qty),
    movementType: 'SALE',
    sourceType: 'SALE_LINE',
    sourceId: idGen.newId(),
    occurredAt: '2026-11-20T10:00:00.000Z',
    businessDate: '2026-11-20',
    order,
  }
}

function gr(t: InventoryTenant, skuId: string, qty: string, value: number, order = 1): MovementIntent {
  return {
    outletId: t.outletA,
    skuId,
    kind: 'IN',
    qty: parseQty(qty),
    valueIn: toMoney(value),
    movementType: 'GR_IN',
    sourceType: 'GR_LINE',
    sourceId: idGen.newId(),
    occurredAt: '2026-11-20T08:00:00.000Z',
    businessDate: '2026-11-20',
    order,
  }
}

async function applyOnce(t: InventoryTenant, intents: MovementIntent[]) {
  return withTenant(t.tenantId, (tx) =>
    applyMovements(tx, { tenantId: t.tenantId, actorId: t.actorUserId, processedAt: new Date().toISOString() }, intents),
  )
}

describe('inventory ledger concurrency (AD-22, BR-STK-001)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('20 penjualan paralel pada SKU yang sama: bal_seq 1..n tanpa celah dan konservasi nilai', async () => {
    const t = await setupInventoryTenant('conc-20')
    await applyOnce(t, [gr(t, t.skuA, '100', 800000)])

    const results = await Promise.all(
      Array.from({ length: 20 }, () => applyOnce(t, [sale(t, t.skuA, '1')])),
    )
    const sum = results.reduce((acc, r) => acc + r.applied[0]!.valueDelta, 0)

    const final = await withTenant(t.tenantId, async (tx) => {
      const seq = await tx.execute<{ bal_seq: string | number }>(sql`
        SELECT bal_seq FROM stock_movement WHERE tenant_id = ${t.tenantId} AND sku_id = ${t.skuA} ORDER BY bal_seq`)
      const bal = await tx.execute<{ qty: string; inventory_value: string }>(sql`
        SELECT qty::text, inventory_value::text FROM stock_balance WHERE tenant_id = ${t.tenantId} AND sku_id = ${t.skuA} AND outlet_id = ${t.outletA}`)
      return { seq: seq.rows.map((r) => Number(r.bal_seq)), bal: bal.rows[0]! }
    })

    expect(final.seq).toEqual(Array.from({ length: 21 }, (_, i) => i + 1))
    expect(normalizeQty(final.bal.qty as Qty)).toBe('80')
    // Conservation: opening value + Σ COGS = closing value.
    expect(Number(final.bal.inventory_value)).toBe(800000 + sum)
  })

  it('dua transaksi dengan urutan SKU berlawanan tidak deadlock (kunci diurut)', async () => {
    const t = await setupInventoryTenant('conc-dl')
    await applyOnce(t, [gr(t, t.skuA, '10', 100000, 1), gr(t, t.skuB, '10', 100000, 2)])

    const txA = applyOnce(t, [sale(t, t.skuA, '1', 1), sale(t, t.skuB, '1', 2)])
    const txB = applyOnce(t, [sale(t, t.skuB, '1', 1), sale(t, t.skuA, '1', 2)])
    const [a, b] = await Promise.all([txA, txB])
    expect(a.applied.length).toBe(2)
    expect(b.applied.length).toBe(2)
  })

  it('lock_timeout 5 dtk: transaksi lain yang menahan baris saldo membuat penerapan gagal dengan lock_not_available', async () => {
    const t = await setupInventoryTenant('conc-lock')
    await applyOnce(t, [gr(t, t.skuA, '10', 100000)])

    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const holder = withTenant(t.tenantId, async (tx) => {
      await tx.execute(sql`SELECT 1 FROM stock_balance WHERE tenant_id = ${t.tenantId} AND sku_id = ${t.skuA} FOR UPDATE`)
      await held
    })
    // Give the holder time to take the lock.
    await new Promise((r) => setTimeout(r, 200))

    const started = Date.now()
    const waiter = applyOnce(t, [sale(t, t.skuA, '1')]).then(
      () => ({ ok: true as const }),
      (err: unknown) => {
        // Drizzle wraps driver errors in `cause`; the SQLSTATE code is in one of them.
        const e = err as { code?: string; cause?: { code?: string } }
        return { ok: false as const, code: e.code ?? e.cause?.code }
      },
    )
    const outcome = await waiter
    const elapsed = Date.now() - started
    release()
    await holder

    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.code).toBe('55P03')
    expect(elapsed).toBeGreaterThanOrEqual(4000)
    expect(elapsed).toBeLessThan(15000)
  }, 60_000)
})
