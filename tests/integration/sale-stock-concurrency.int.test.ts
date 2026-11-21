import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator, normalizeQty, parseQty, toMoney, type Qty } from '~/lib/kernel'
import { applyMovements, applySaleStock, type SaleStockLine } from '~/modules/inventory/public'
import { closePools, withTenant } from '~/server/db'
import { enableOutletInventory, setupInventoryTenant, type InventoryTenant } from './helpers/inventory'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

async function receive(t: InventoryTenant, skuId: string, qty: string, value: number) {
  await withTenant(t.tenantId, (tx) =>
    applyMovements(tx, { tenantId: t.tenantId, processedAt: '2026-11-20T09:00:00.000Z' }, [
      {
        outletId: t.outletA,
        skuId,
        kind: 'IN',
        qty: parseQty(qty),
        valueIn: toMoney(value),
        movementType: 'GR_IN',
        sourceType: 'GR_LINE',
        sourceId: idGen.newId(),
        occurredAt: '2026-11-20T09:00:00.000Z',
        businessDate: '2026-11-20',
        order: 1,
      },
    ]),
  )
}

function line(skuId: string, lineNo: number, qty: string): SaleStockLine {
  return { lineId: idGen.newId(), lineNo, lineKind: 'ITEM', skuId, qtyBase: parseQty(qty) }
}

async function sellLines(t: InventoryTenant, lines: SaleStockLine[]) {
  return withTenant(t.tenantId, (tx) =>
    applySaleStock(tx, {
      tenantId: t.tenantId,
      outletId: t.outletA,
      saleId: idGen.newId(),
      occurredAt: '2026-11-20T10:00:00.000Z',
      businessDate: '2026-11-20',
      processedAt: new Date().toISOString(),
      commandId: null,
      actorId: t.actorUserId,
      lines,
    }),
  )
}

describe('sale stock concurrency (AD-22, BR-STK-001)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('20 FinalizeSale paralel pada satu SKU: bal_seq 1..n tanpa celah dan Σ HPP + saldo akhir = nilai awal', async () => {
    const t = await setupInventoryTenant('sc-20')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await receive(t, t.skuA, '100', 800000)

    const results = await Promise.all(Array.from({ length: 20 }, () => sellLines(t, [line(t.skuA, 1, '1')])))
    const hpp = results.reduce((acc, r) => acc + (r.costTotal ?? 0), 0)

    const { seq, final } = await withTenant(t.tenantId, async (tx) => {
      const s = await tx.execute<{ bal_seq: string | number }>(sql`
        SELECT bal_seq FROM stock_movement WHERE tenant_id = ${t.tenantId} AND sku_id = ${t.skuA} ORDER BY bal_seq`)
      const b = await tx.execute<{ qty: string; inventory_value: string }>(sql`
        SELECT qty::text, inventory_value::text FROM stock_balance WHERE tenant_id = ${t.tenantId} AND sku_id = ${t.skuA} AND outlet_id = ${t.outletA}`)
      return { seq: s.rows.map((r) => Number(r.bal_seq)), final: b.rows[0]! }
    })
    expect(seq).toEqual(Array.from({ length: 21 }, (_, i) => i + 1))
    expect(normalizeQty(final.qty as Qty)).toBe('80')
    expect(Number(final.inventory_value) + hpp).toBe(800000)
  })

  it('dua FinalizeSale dengan urutan SKU berlawanan tidak deadlock', async () => {
    const t = await setupInventoryTenant('sc-dl')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await receive(t, t.skuA, '10', 100000)
    await receive(t, t.skuB, '10', 100000)

    const a = sellLines(t, [line(t.skuA, 1, '1'), line(t.skuB, 2, '1')])
    const b = sellLines(t, [line(t.skuB, 1, '1'), line(t.skuA, 2, '1')])
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.costTotal).toBe(20000)
    expect(rb.costTotal).toBe(20000)
  })

  it('lock_timeout 5 dtk: penjualan yang menunggu kunci saldo gagal dengan 55P03 tanpa menulis movement', async () => {
    const t = await setupInventoryTenant('sc-lock')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await receive(t, t.skuA, '10', 100000)
    const before = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM stock_movement WHERE tenant_id = ${t.tenantId}`)
      return Number(r.rows[0]!.n)
    })

    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const holder = withTenant(t.tenantId, async (tx) => {
      await tx.execute(sql`SELECT 1 FROM stock_balance WHERE tenant_id = ${t.tenantId} AND sku_id = ${t.skuA} FOR UPDATE`)
      await held
    })
    await new Promise((r) => setTimeout(r, 200))

    const outcome = await sellLines(t, [line(t.skuA, 1, '1')]).then(
      () => ({ ok: true as const }),
      (err: unknown) => {
        const e = err as { code?: string; cause?: { code?: string } }
        return { ok: false as const, code: e.code ?? e.cause?.code }
      },
    )
    release()
    await holder

    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.code).toBe('55P03')
    const after = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM stock_movement WHERE tenant_id = ${t.tenantId}`)
      return Number(r.rows[0]!.n)
    })
    expect(after).toBe(before)
  }, 60_000)
})
