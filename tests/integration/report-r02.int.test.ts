import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { normalizeQty, parseQty, toMoney, type Qty } from '~/lib/kernel'
import { applyMovements, postGr, reportR02, saveGrDraft, saveTransferDraft, sendTransfer, receiveTransfer } from '~/modules/inventory/public'
import { closePools, withTenant } from '~/server/db'
import { enableOutletInventory, setupInventoryTenant, type InventoryTenant } from './helpers/inventory'

async function gr(t: InventoryTenant, outletId: string, skuId: string, qty: string, value: number) {
  const d = await saveGrDraft(t.actor, {
    outletId,
    businessDate: '2026-11-20',
    lines: [{ skuId, uomId: t.pcsUomId, qty, lineValue: value, unitCost: null }],
  })
  return postGr(t.actor, d.id)
}

async function v15Setup(prefix: string) {
  const t = await setupInventoryTenant(prefix)
  await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
  await enableOutletInventory(t.tenantId, t.outletB, '2026-11-01T00:00:00.000Z')
  await gr(t, t.outletA, t.skuA, '120', 985000)
  await gr(t, t.outletB, t.skuA, '10', 90000)
  return t
}

describe('laporan R-02 stok & nilai persediaan (FR-RPT-003, K04)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('contoh PRD R-02: A 80/656.667 (rata-rata 8.208,34); B 10/90.000 dengan in-transit 40/328.333 sebelum diterima', async () => {
    const t = await v15Setup('r02-v15')
    const draft = await saveTransferDraft(t.actor, {
      fromOutletId: t.outletA,
      toOutletId: t.outletB,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qtyInput: '40' }],
    })
    await sendTransfer(t.actor, draft.id)

    const before = await reportR02(t.actor, {})
    const rowA = before.rows.find((r) => r.outletId === t.outletA && r.skuId === t.skuA)!
    expect(rowA.qty).toBe('80')
    expect(rowA.inventoryValue).toBe(656667)
    expect(rowA.avgCost).toBe('8208.34')
    const rowB = before.rows.find((r) => r.outletId === t.outletB && r.skuId === t.skuA)!
    expect(rowB.qty).toBe('10')
    expect(rowB.inventoryValue).toBe(90000)
    expect(normalizeQty(rowB.qtyInTransit as Qty)).toBe('40')
    expect(rowB.valueInTransit).toBe(328333)
    const totalB = before.totals.find((x) => x.outletId === t.outletB)!
    expect(totalB.valueInTransit).toBe(328333)

    const [line] = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`SELECT id FROM transfer_line WHERE tenant_id = ${t.tenantId} AND transfer_id = ${draft.id}`)
      return r.rows
    })
    await receiveTransfer(t.actor, draft.id, { lines: [{ lineId: line!.id, qtyReceivedBase: '38' }] })

    const after = await reportR02(t.actor, {})
    const rowBAfter = after.rows.find((r) => r.outletId === t.outletB && r.skuId === t.skuA)!
    expect(rowBAfter.qty).toBe('48')
    expect(rowBAfter.inventoryValue).toBe(401916)
    expect(rowBAfter.qtyInTransit).toBe('0')
    expect(rowBAfter.valueInTransit).toBe(0)
  })

  it('filter stok minus dan in-transit; stok minus tampil bertanda', async () => {
    const t = await setupInventoryTenant('r02-neg')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await enableOutletInventory(t.tenantId, t.outletB, '2026-11-01T00:00:00.000Z')
    await gr(t, t.outletA, t.skuA, '5', 50000)
    const draft = await saveTransferDraft(t.actor, {
      fromOutletId: t.outletA,
      toOutletId: t.outletB,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qtyInput: '8' }],
    })
    await sendTransfer(t.actor, draft.id)

    const neg = await reportR02(t.actor, { onlyNegative: true })
    expect(neg.rows).toHaveLength(1)
    expect(neg.rows[0]!.outletId).toBe(t.outletA)
    expect(neg.rows[0]!.isNegative).toBe(true)
    expect(neg.rows[0]!.qty).toBe('-3')
    expect(neg.totals[0]!.negativeCount).toBe(1)

    const transit = await reportR02(t.actor, { onlyInTransit: true })
    expect(transit.rows.every((r) => r.outletId === t.outletB)).toBe(true)
    expect(transit.rows[0]!.valueInTransit).toBe(80000)
  })

  it('K04 rekonsiliasi: Σ value_delta ledger = inventory_value saldo untuk setiap (outlet, SKU)', async () => {
    const t = await v15Setup('r02-recon')
    await gr(t, t.outletA, t.skuB, '4', 4000)
    const rows = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ outlet_id: string; sku_id: string; bal: string; mv: string }>(sql`
        SELECT b.outlet_id, b.sku_id, b.inventory_value::text AS bal, COALESCE(m.s, 0)::text AS mv
        FROM stock_balance b
        LEFT JOIN (
          SELECT outlet_id, sku_id, sum(value_delta) AS s FROM stock_movement
          WHERE tenant_id = ${t.tenantId}::uuid GROUP BY outlet_id, sku_id
        ) m ON m.outlet_id = b.outlet_id AND m.sku_id = b.sku_id
        WHERE b.tenant_id = ${t.tenantId}::uuid`)
      return r.rows
    })
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(Number(r.mv)).toBe(Number(r.bal))
  })

  it('ketersediaan default AVAILABLE dan filter UNAVAILABLE kosong bila tidak ada item tidak tersedia', async () => {
    const t = await v15Setup('r02-avail')
    const report = await reportR02(t.actor, { availability: 'UNAVAILABLE' })
    expect(report.rows).toHaveLength(0)
    const all = await reportR02(t.actor, {})
    expect(all.rows.every((r) => r.availability === 'AVAILABLE')).toBe(true)
  })
})

// Kontrol: applyMovements langsung tetap menghasilkan saldo yang dibaca R-02 (tanpa dokumen).
describe('R-02 membaca saldo dari ledger langsung', () => {
  it('movement langsung terlihat di laporan', async () => {
    const t = await setupInventoryTenant('r02-direct')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await withTenant(t.tenantId, (tx) =>
      applyMovements(tx, { tenantId: t.tenantId, processedAt: '2026-11-20T09:00:00.000Z' }, [
        {
          outletId: t.outletA,
          skuId: t.skuA,
          kind: 'IN',
          qty: parseQty('2'),
          valueIn: toMoney(2000),
          movementType: 'GR_IN',
          sourceType: 'GR_LINE',
          sourceId: crypto.randomUUID(),
          occurredAt: '2026-11-20T09:00:00.000Z',
          businessDate: '2026-11-20',
          order: 1,
        },
      ]),
    )
    const report = await reportR02(t.actor, { outletId: t.outletA })
    expect(report.rows[0]!.qty).toBe('2')
    expect(report.rows[0]!.inventoryValue).toBe(2000)
  })
})
