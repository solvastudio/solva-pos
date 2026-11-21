import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { normalizeQty, type Qty } from '~/lib/kernel'
import { applySaleStock, postGr, reverseGr, saveGrDraft } from '~/modules/inventory/public'
import { closePools, withTenant } from '~/server/db'
import { addSkuUom, enableOutletInventory, setupInventoryTenant, type InventoryTenant } from './helpers/inventory'
import { createIdGenerator, parseQty } from '~/lib/kernel'
import { webcrypto } from 'node:crypto'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

async function balance(t: InventoryTenant, skuId: string) {
  return withTenant(t.tenantId, async (tx) => {
    const r = await tx.execute<{ qty: string; inventory_value: string }>(sql`
      SELECT qty::text, inventory_value::text FROM stock_balance
      WHERE tenant_id = ${t.tenantId} AND outlet_id = ${t.outletA} AND sku_id = ${skuId}`)
    const row = r.rows[0]
    return row ? { qty: normalizeQty(row.qty as Qty), value: Number(row.inventory_value) } : null
  })
}

async function postOne(t: InventoryTenant, lines: Array<{ skuId: string; uomId: string; qty: string; lineValue?: number; unitCost?: number }>) {
  const draft = await saveGrDraft(t.actor, {
    outletId: t.outletA,
    businessDate: '2026-11-20',
    lines: lines.map((l) => ({ skuId: l.skuId, uomId: l.uomId, qty: l.qty, lineValue: l.lineValue ?? null, unitCost: l.unitCost ?? null })),
  })
  return postGr(t.actor, draft.id)
}

describe('goods receipt (FR-INV-001/008, BR-STK-020/021/022, FLOW-11)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('V-12 (GR bagian tabel): GR 100 pcs @8000 lalu GR 50 @425000 menghasilkan saldo 150/1.225.000; nomor GR-OUT01-1126-0001 dan -0002', async () => {
    const t = await setupInventoryTenant('gr-v12')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    const g1 = await postOne(t, [{ skuId: t.skuA, uomId: t.pcsUomId, qty: '100', lineValue: 800000 }])
    expect(g1.docNo).toBe('GR-OUT01-1126-0001')
    const g2 = await postOne(t, [{ skuId: t.skuA, uomId: t.pcsUomId, qty: '50', lineValue: 425000 }])
    expect(g2.docNo).toBe('GR-OUT01-1126-0002')
    expect(await balance(t, t.skuA)).toEqual({ qty: '150', value: 1225000 })
  })

  it('BR-STK-020: 5 dus @96.000 (faktor 12) → qty dasar 60 pcs, nilai 480.000', async () => {
    const t = await setupInventoryTenant('gr-dus')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    const dusId = await addSkuUom(t.tenantId, t.skuA, 'dus', 12)
    const g = await postOne(t, [{ skuId: t.skuA, uomId: dusId, qty: '5', unitCost: 96000 }])
    expect(g.totalValue).toBe(480000)
    expect(await balance(t, t.skuA)).toEqual({ qty: '60', value: 480000 })
  })

  it('posting idempoten: posting ulang GR yang sama tidak menambah stok', async () => {
    const t = await setupInventoryTenant('gr-idem')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    const draft = await saveGrDraft(t.actor, {
      outletId: t.outletA,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qty: '10', lineValue: 100000, unitCost: null }],
    })
    const first = await postGr(t.actor, draft.id)
    const second = await postGr(t.actor, draft.id)
    expect(first.applied).toBe(true)
    expect(second.applied).toBe(false)
    expect(await balance(t, t.skuA)).toEqual({ qty: '10', value: 100000 })
  })

  it('GR ditolak sebelum aktivasi stok outlet', async () => {
    const t = await setupInventoryTenant('gr-noact')
    const draft = await saveGrDraft(t.actor, {
      outletId: t.outletA,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qty: '1', lineValue: 1000, unitCost: null }],
    })
    await expect(postGr(t.actor, draft.id)).rejects.toThrow(/trackingNotEnabled/)
  })

  it('reversal: GR 60 pcs/480.000 dibalik persis (saldo kembali 0); reversal ganda ditolak', async () => {
    const t = await setupInventoryTenant('gr-rev')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    const dusId = await addSkuUom(t.tenantId, t.skuA, 'dus', 12)
    const g = await postOne(t, [{ skuId: t.skuA, uomId: dusId, qty: '5', unitCost: 96000 }])
    const rev = await reverseGr(t.actor, g.id, 'Salah input pemasok')
    expect(rev.docNo).toMatch(/^GR-OUT01-1126-0002$/)
    expect(await balance(t, t.skuA)).toEqual({ qty: '0', value: 0 })
    await expect(reverseGr(t.actor, g.id, 'lagi')).rejects.toThrow(/sudah dikoreksi/)
  })

  it('reversal setelah sebagian terjual: saldo negatif dan flag STOK_MINUS, tidak ditolak', async () => {
    const t = await setupInventoryTenant('gr-rev-neg')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    const g = await postOne(t, [{ skuId: t.skuA, uomId: t.pcsUomId, qty: '10', lineValue: 100000 }])
    await withTenant(t.tenantId, (tx) =>
      applySaleStock(tx, {
        tenantId: t.tenantId,
        outletId: t.outletA,
        saleId: idGen.newId(),
        occurredAt: '2026-11-20T12:00:00.000Z',
        businessDate: '2026-11-20',
        processedAt: '2026-11-20T12:00:00.000Z',
        commandId: null,
        actorId: t.actorUserId,
        lines: [{ lineId: idGen.newId(), lineNo: 1, lineKind: 'ITEM', skuId: t.skuA, qtyBase: parseQty('6') }],
      }),
    )
    await reverseGr(t.actor, g.id, 'Koreksi')
    expect(await balance(t, t.skuA)).toEqual({ qty: '-6', value: -60000 })
  })
})
