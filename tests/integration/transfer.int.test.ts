import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator, normalizeQty, parseQty, toMoney, type Qty } from '~/lib/kernel'
import {
  applyMovements,
  cancelTransferDraft,
  postGr,
  receiveTransfer,
  saveGrDraft,
  saveTransferDraft,
  sendTransfer,
} from '~/modules/inventory/public'
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

async function bal(t: InventoryTenant, outletId: string, skuId: string) {
  return withTenant(t.tenantId, async (tx) => {
    const r = await tx.execute<{ qty: string; inventory_value: string }>(sql`
      SELECT qty::text, inventory_value::text FROM stock_balance
      WHERE tenant_id = ${t.tenantId} AND outlet_id = ${outletId} AND sku_id = ${skuId}`)
    const row = r.rows[0]
    return row ? { qty: normalizeQty(row.qty as Qty), value: Number(row.inventory_value) } : null
  })
}

async function gr(t: InventoryTenant, outletId: string, skuId: string, qty: string, value: number) {
  const d = await saveGrDraft(t.actor, {
    outletId,
    businessDate: '2026-11-20',
    lines: [{ skuId, uomId: t.pcsUomId, qty, lineValue: value, unitCost: null }],
  })
  return postGr(t.actor, d.id)
}

/** Skenario V-15: A 120/985.000; B 10/90.000. */
async function v15Setup(prefix: string) {
  const t = await setupInventoryTenant(prefix)
  await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
  await enableOutletInventory(t.tenantId, t.outletB, '2026-11-01T00:00:00.000Z')
  await gr(t, t.outletA, t.skuA, '120', 985000)
  await gr(t, t.outletB, t.skuA, '10', 90000)
  return t
}

describe('inter-outlet transfer (FR-INV-006, FLOW-12, BR-TRF-001..004, V-15)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('V-15: send 40 from A (value_sent 328.333; A 80/656.667; in-transit 40/328.333); receive 38 at B (value_received 311.916; B 48/401.916; difference 2 pcs / 16.417 flagged)', async () => {
    const t = await v15Setup('tr-v15')
    const draft = await saveTransferDraft(t.actor, {
      fromOutletId: t.outletA,
      toOutletId: t.outletB,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qtyInput: '40' }],
    })
    await sendTransfer(t.actor, draft.id)
    expect(await bal(t, t.outletA, t.skuA)).toEqual({ qty: '80', value: 656667 })

    const inTransit = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ qty_in_transit: string; value_in_transit: string }>(sql`
        SELECT qty_in_transit::text, value_in_transit::text FROM v_in_transit
        WHERE tenant_id = ${t.tenantId} AND outlet_id = ${t.outletB} AND sku_id = ${t.skuA}`)
      return r.rows[0]
    })
    expect(normalizeQty(inTransit!.qty_in_transit as Qty)).toBe('40')
    expect(Number(inTransit!.value_in_transit)).toBe(328333)

    const [line] = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`SELECT id FROM transfer_line WHERE tenant_id = ${t.tenantId} AND transfer_id = ${draft.id}`)
      return r.rows
    })
    const rec = await receiveTransfer(t.actor, draft.id, {
      lines: [{ lineId: line!.id, qtyReceivedBase: '38' }],
    })
    expect(rec.valueVariance).toBe(16417)
    expect(await bal(t, t.outletB, t.skuA)).toEqual({ qty: '48', value: 401916 })

    const flags = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ diff_amount: string }>(sql`
        SELECT diff_amount::text FROM data_flag WHERE tenant_id = ${t.tenantId} AND flag_code = 'SELISIH_TRANSFER'`)
      return r.rows
    })
    expect(flags.length).toBe(1)
    expect(Number(flags[0]!.diff_amount)).toBe(16417)
  })

  it('receiving twice is rejected; receipt above the sent quantity is rejected', async () => {
    const t = await v15Setup('tr-twice')
    const draft = await saveTransferDraft(t.actor, {
      fromOutletId: t.outletA,
      toOutletId: t.outletB,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qtyInput: '40' }],
    })
    await sendTransfer(t.actor, draft.id)
    const [line] = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`SELECT id FROM transfer_line WHERE tenant_id = ${t.tenantId} AND transfer_id = ${draft.id}`)
      return r.rows
    })
    await expect(
      receiveTransfer(t.actor, draft.id, { lines: [{ lineId: line!.id, qtyReceivedBase: '41' }] }),
    ).rejects.toThrow(/kelebihan/)
    await receiveTransfer(t.actor, draft.id, { lines: [{ lineId: line!.id, qtyReceivedBase: '40' }] })
    await expect(
      receiveTransfer(t.actor, draft.id, { lines: [{ lineId: line!.id, qtyReceivedBase: '40' }] }),
    ).rejects.toThrow(/sudah diterima|belum dikirim/)
  })

  it('a zero receipt for all lines requires a close reason', async () => {
    const t = await v15Setup('tr-close')
    const draft = await saveTransferDraft(t.actor, {
      fromOutletId: t.outletA,
      toOutletId: t.outletB,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qtyInput: '5' }],
    })
    await sendTransfer(t.actor, draft.id)
    const [line] = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`SELECT id FROM transfer_line WHERE tenant_id = ${t.tenantId} AND transfer_id = ${draft.id}`)
      return r.rows
    })
    await expect(
      receiveTransfer(t.actor, draft.id, { lines: [{ lineId: line!.id, qtyReceivedBase: '0' }] }),
    ).rejects.toThrow(/Alasan penutupan/)
    await receiveTransfer(t.actor, draft.id, {
      lines: [{ lineId: line!.id, qtyReceivedBase: '0' }],
      closeReasonCode: 'LOST_IN_TRANSIT',
      closeReasonText: 'Kurir tidak datang',
    })
    expect(await bal(t, t.outletB, t.skuA)).toEqual({ qty: '10', value: 90000 })
  })

  it('sending from low stock: not rejected, negative balance and STOK_MINUS flag', async () => {
    const t = await setupInventoryTenant('tr-neg')
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
    expect(await bal(t, t.outletA, t.skuA)).toEqual({ qty: '-3', value: -30000 })
    const flags = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM data_flag WHERE tenant_id = ${t.tenantId} AND flag_code = 'STOK_MINUS'`)
      return Number(r.rows[0]!.n)
    })
    expect(flags).toBeGreaterThanOrEqual(1)
  })

  it('cancel only from DRAFT; cannot be canceled after sending', async () => {
    const t = await v15Setup('tr-cancel')
    const draft = await saveTransferDraft(t.actor, {
      fromOutletId: t.outletA,
      toOutletId: t.outletB,
      businessDate: '2026-11-20',
      lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qtyInput: '1' }],
    })
    await cancelTransferDraft(t.actor, draft.id)
    await expect(sendTransfer(t.actor, draft.id)).rejects.toThrow(/dikirim atau dibatalkan/)
  })

  it('destination equal to source is rejected', async () => {
    const t = await setupInventoryTenant('tr-same')
    await expect(
      saveTransferDraft(t.actor, {
        fromOutletId: t.outletA,
        toOutletId: t.outletA,
        businessDate: '2026-11-20',
        lines: [{ skuId: t.skuA, uomId: t.pcsUomId, qtyInput: '1' }],
      }),
    ).rejects.toThrow(/berbeda/)
  })

  it('applyMovements can still be called directly (control): V-15 does not depend on the draft path', async () => {
    const t = await setupInventoryTenant('tr-control')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await withTenant(t.tenantId, (tx) =>
      applyMovements(tx, { tenantId: t.tenantId, processedAt: '2026-11-20T09:00:00.000Z' }, [
        {
          outletId: t.outletA,
          skuId: t.skuA,
          kind: 'IN',
          qty: parseQty('1'),
          valueIn: toMoney(1000),
          movementType: 'GR_IN',
          sourceType: 'GR_LINE',
          sourceId: idGen.newId(),
          occurredAt: '2026-11-20T09:00:00.000Z',
          businessDate: '2026-11-20',
          order: 1,
        },
      ]),
    )
    expect(await bal(t, t.outletA, t.skuA)).toEqual({ qty: '1', value: 1000 })
  })
})
