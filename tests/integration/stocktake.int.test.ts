import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator, normalizeQty, parseQty, toMoney, type Qty } from '~/lib/kernel'
import {
  applyMovements,
  applySaleStock,
  cancelStocktake,
  createStocktake,
  enableOutletTracking,
  postStocktake,
  previewStocktake,
  saveStocktakeCounts,
} from '~/modules/inventory/public'
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

async function bal(t: InventoryTenant, skuId: string) {
  return withTenant(t.tenantId, async (tx) => {
    const r = await tx.execute<{ qty: string; inventory_value: string }>(sql`
      SELECT qty::text, inventory_value::text FROM stock_balance
      WHERE tenant_id = ${t.tenantId} AND outlet_id = ${t.outletA} AND sku_id = ${skuId}`)
    const row = r.rows[0]
    return row ? { qty: normalizeQty(row.qty as Qty), value: Number(row.inventory_value) } : null
  })
}

async function seed(t: InventoryTenant, skuId: string, qty: string, value: number) {
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

/** Sales must be processed AFTER `inventory_enabled_at` (set with the real clock by activation). */
async function sell(t: InventoryTenant, skuId: string, qty: string) {
  const nowIso = new Date().toISOString()
  await withTenant(t.tenantId, (tx) =>
    applySaleStock(tx, {
      tenantId: t.tenantId,
      outletId: t.outletA,
      saleId: idGen.newId(),
      occurredAt: nowIso,
      businessDate: '2026-11-20',
      processedAt: nowIso,
      commandId: null,
      actorId: t.actorUserId,
      lines: [{ lineId: idGen.newId(), lineNo: 1, lineKind: 'ITEM', skuId, qtyBase: parseQty(qty) }],
    }),
  )
}

async function countLines(t: InventoryTenant, docId: string) {
  return withTenant(t.tenantId, async (tx) => {
    const r = await tx.execute<{ id: string; sku_id: string }>(sql`
      SELECT id, sku_id FROM stocktake_line WHERE tenant_id = ${t.tenantId} AND stocktake_id = ${docId}`)
    return r.rows
  })
}

describe('stocktake (FR-INV-007, FLOW-13, BR-STK-030..032, V-16)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('V-16 (delta −3 and +5 from 80/656.667): 77/632.042 and 85/697.709', async () => {
    const t1 = await setupInventoryTenant('opn-minus')
    await enableOutletTracking(t1.actor, t1.outletA)
    await seed(t1, t1.skuA, '80', 656667)
    const s1 = await createStocktake(t1.actor, { outletId: t1.outletA, businessDate: '2026-11-20', scope: 'SELECTED', skuIds: [t1.skuA] })
    const [l1] = await countLines(t1, s1.id)
    await saveStocktakeCounts(t1.actor, s1.id, [{ lineId: l1!.id, countedQty: '77' }])
    const preview = await previewStocktake(t1.actor, s1.id)
    expect(preview.totalDeltaValue).toBe(-24625)
    await postStocktake(t1.actor, s1.id)
    expect(await bal(t1, t1.skuA)).toEqual({ qty: '77', value: 632042 })

    const t2 = await setupInventoryTenant('opn-plus')
    await enableOutletTracking(t2.actor, t2.outletA)
    await seed(t2, t2.skuA, '80', 656667)
    const s2 = await createStocktake(t2.actor, { outletId: t2.outletA, businessDate: '2026-11-20', scope: 'SELECTED', skuIds: [t2.skuA] })
    const [l2] = await countLines(t2, s2.id)
    await saveStocktakeCounts(t2.actor, s2.id, [{ lineId: l2!.id, countedQty: '85' }])
    const posted = await postStocktake(t2.actor, s2.id)
    expect(posted.totalDeltaValue).toBe(41042)
    expect(await bal(t2, t2.skuA)).toEqual({ qty: '85', value: 697709 })
  })

  it('V-16 (physical 0 from balance −2/−16.000 → value 0, movement +16.000; physical 5 → 5/40.000)', async () => {
    const tenant = await setupInventoryTenant('opn-neg')
    await enableOutletTracking(tenant.actor, tenant.outletA)
    await seed(tenant, tenant.skuA, '3', 24000)
    await sell(tenant, tenant.skuA, '5')
    expect(await bal(tenant, tenant.skuA)).toEqual({ qty: '-2', value: -16000 })

    const s = await createStocktake(tenant.actor, { outletId: tenant.outletA, businessDate: '2026-11-20', scope: 'SELECTED', skuIds: [tenant.skuA] })
    const [l] = await countLines(tenant, s.id)
    await saveStocktakeCounts(tenant.actor, s.id, [{ lineId: l!.id, countedQty: '0' }])
    const res = await postStocktake(tenant.actor, s.id)
    expect(res.totalDeltaValue).toBe(16000)
    expect(await bal(tenant, tenant.skuA)).toEqual({ qty: '0', value: 0 })

    const t2 = await setupInventoryTenant('opn-neg5')
    await enableOutletTracking(t2.actor, t2.outletA)
    await seed(t2, t2.skuA, '3', 24000)
    await sell(t2, t2.skuA, '5')
    const s2 = await createStocktake(t2.actor, { outletId: t2.outletA, businessDate: '2026-11-20', scope: 'SELECTED', skuIds: [t2.skuA] })
    const [l2] = await countLines(t2, s2.id)
    await saveStocktakeCounts(t2.actor, s2.id, [{ lineId: l2!.id, countedQty: '5' }])
    await postStocktake(t2.actor, s2.id)
    expect(await bal(t2, t2.skuA)).toEqual({ qty: '5', value: 40000 })
  })

  it('BR-STK-031: snapshot 80, count 77, sale of 5 after the snapshot → posting balance 75 → 72 (sale not lost)', async () => {
    const t = await setupInventoryTenant('opn-br31')
    await enableOutletTracking(t.actor, t.outletA)
    await seed(t, t.skuA, '80', 656667)
    const s = await createStocktake(t.actor, { outletId: t.outletA, businessDate: '2026-11-20', scope: 'SELECTED', skuIds: [t.skuA] })
    await sell(t, t.skuA, '5')
    expect(await bal(t, t.skuA)).toEqual({ qty: '75', value: 615625 })
    const [l] = await countLines(t, s.id)
    await saveStocktakeCounts(t.actor, s.id, [{ lineId: l!.id, countedQty: '77' }])
    await postStocktake(t.actor, s.id)
    expect(await bal(t, t.skuA)).toEqual({ qty: '72', value: 591000 })
  })

  it('a draft can be canceled; posting after cancel is rejected; incomplete counts are rejected', async () => {
    const t = await setupInventoryTenant('opn-cancel')
    await enableOutletTracking(t.actor, t.outletA)
    await seed(t, t.skuA, '10', 10000)
    const s = await createStocktake(t.actor, { outletId: t.outletA, businessDate: '2026-11-20', scope: 'SELECTED', skuIds: [t.skuA] })
    await expect(postStocktake(t.actor, s.id)).rejects.toThrow(/allLinesCounted/)
    await cancelStocktake(t.actor, s.id)
    await expect(postStocktake(t.actor, s.id)).rejects.toThrow(/stocktakeClosed/)
  })

  it('stocktake without stock activation is rejected', async () => {
    const t = await setupInventoryTenant('opn-noact')
    await expect(
      createStocktake(t.actor, { outletId: t.outletA, businessDate: '2026-11-20', scope: 'SELECTED', skuIds: [t.skuA] }),
    ).rejects.toThrow(/trackingNotEnabled/)
  })
})

describe('stock tracking activation (BR-STK-004)', () => {
  it('enableOutletTracking is idempotent and bumps the master version', async () => {
    const t = await setupInventoryTenant('act')
    const first = await enableOutletTracking(t.actor, t.outletA)
    const second = await enableOutletTracking(t.actor, t.outletA)
    expect(second.enabledAt).toBe(first.enabledAt)
    const v = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ inventory_enabled_at: string | null }>(sql`
        SELECT inventory_enabled_at::text AS inventory_enabled_at FROM outlet WHERE tenant_id = ${t.tenantId} AND id = ${t.outletA}`)
      return r.rows[0]!.inventory_enabled_at
    })
    expect(v).not.toBeNull()
  })
})
