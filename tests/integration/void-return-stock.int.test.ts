import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator, normalizeQty, parseQty, toMoney, type Qty } from '~/lib/kernel'
import { applyMovements, applyReturnStock, applySaleStock, applyVoidStock } from '~/modules/inventory/public'
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

async function balance(t: InventoryTenant, skuId: string) {
  return withTenant(t.tenantId, async (tx) => {
    const r = await tx.execute<{ qty: string; inventory_value: string }>(sql`
      SELECT qty::text, inventory_value::text FROM stock_balance
      WHERE tenant_id = ${t.tenantId} AND outlet_id = ${t.outletA} AND sku_id = ${skuId}`)
    const row = r.rows[0]!
    return { qty: normalizeQty(row.qty as Qty), value: Number(row.inventory_value) }
  })
}

async function movementTypes(t: InventoryTenant, skuId: string): Promise<string[]> {
  return withTenant(t.tenantId, async (tx) => {
    const r = await tx.execute<{ movement_type: string }>(sql`
      SELECT movement_type FROM stock_movement WHERE tenant_id = ${t.tenantId} AND sku_id = ${skuId} ORDER BY bal_seq`)
    return r.rows.map((x) => x.movement_type)
  })
}

describe('void & return stock (BR-HPP-007, BR-STK-007)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('void sale of 7 pcs: SALE_VOID +original COGS, balance back to the pre-sale state; repeated void is idempotent', async () => {
    const t = await setupInventoryTenant('vr-void')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await receive(t, t.skuA, '10', 100000)
    const saleLine = idGen.newId()
    const sale = await withTenant(t.tenantId, (tx) =>
      applySaleStock(tx, {
        tenantId: t.tenantId,
        outletId: t.outletA,
        saleId: idGen.newId(),
        occurredAt: '2026-11-20T10:00:00.000Z',
        businessDate: '2026-11-20',
        processedAt: '2026-11-20T10:00:00.000Z',
        commandId: null,
        actorId: t.actorUserId,
        lines: [{ lineId: saleLine, lineNo: 1, lineKind: 'ITEM', skuId: t.skuA, qtyBase: parseQty('7') }],
      }),
    )
    expect(sale.costTotal).toBe(70000)
    expect(await balance(t, t.skuA)).toEqual({ qty: '3', value: 30000 })

    const voidInput = {
      tenantId: t.tenantId,
      outletId: t.outletA,
      occurredAt: '2026-11-20T10:05:00.000Z',
      businessDate: '2026-11-20',
      processedAt: '2026-11-20T10:05:00.000Z',
      commandId: null,
      actorId: t.actorUserId,
      lines: [
        {
          lineId: saleLine,
          lineNo: 1,
          skuId: t.skuA,
          qtyBase: parseQty('7'),
          costSnapshot: toMoney(70000),
          returnedQtyBase: parseQty('0'),
          returnedCost: toMoney(0),
        },
      ],
    }
    await withTenant(t.tenantId, (tx) => applyVoidStock(tx, voidInput))
    expect(await balance(t, t.skuA)).toEqual({ qty: '10', value: 100000 })
    expect((await movementTypes(t, t.skuA)).slice(-1)).toEqual(['SALE_VOID'])

    await withTenant(t.tenantId, (tx) => applyVoidStock(tx, voidInput))
    expect(await balance(t, t.skuA)).toEqual({ qty: '10', value: 100000 })
    expect((await movementTypes(t, t.skuA)).length).toBe(3)
  })

  it('void after a partial return: only the not-yet-returned remainder is reversed', async () => {
    const t = await setupInventoryTenant('vr-part')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await receive(t, t.skuA, '10', 100000)
    const saleLine = idGen.newId()
    await withTenant(t.tenantId, (tx) =>
      applySaleStock(tx, {
        tenantId: t.tenantId,
        outletId: t.outletA,
        saleId: idGen.newId(),
        occurredAt: '2026-11-20T10:00:00.000Z',
        businessDate: '2026-11-20',
        processedAt: '2026-11-20T10:00:00.000Z',
        commandId: null,
        actorId: t.actorUserId,
        lines: [{ lineId: saleLine, lineNo: 1, lineKind: 'ITEM', skuId: t.skuA, qtyBase: parseQty('7') }],
      }),
    )
    const cn = await withTenant(t.tenantId, (tx) =>
      applyReturnStock(tx, {
        tenantId: t.tenantId,
        outletId: t.outletA,
        occurredAt: '2026-11-20T11:00:00.000Z',
        businessDate: '2026-11-20',
        processedAt: '2026-11-20T11:00:00.000Z',
        commandId: null,
        actorId: t.actorUserId,
        lines: [
          {
            creditNoteLineId: idGen.newId(),
            lineNo: 1,
            saleLineId: saleLine,
            skuId: t.skuA,
            disposition: 'KEMBALI_STOK',
            qtyReturnedBase: parseQty('1'),
            saleQtyBase: parseQty('7'),
            costSnapshot: toMoney(70000),
            returnedQtyBefore: parseQty('0'),
            costReturnedBefore: toMoney(0),
          },
        ],
      }),
    )
    expect(cn.lines[0]!.costReturned).toBe(10000)
    expect(await balance(t, t.skuA)).toEqual({ qty: '4', value: 40000 })

    await withTenant(t.tenantId, (tx) =>
      applyVoidStock(tx, {
        tenantId: t.tenantId,
        outletId: t.outletA,
        occurredAt: '2026-11-20T12:00:00.000Z',
        businessDate: '2026-11-20',
        processedAt: '2026-11-20T12:00:00.000Z',
        commandId: null,
        actorId: t.actorUserId,
        lines: [
          {
            lineId: saleLine,
            lineNo: 1,
            skuId: t.skuA,
            qtyBase: parseQty('7'),
            costSnapshot: toMoney(70000),
            returnedQtyBase: parseQty('1'),
            returnedCost: toMoney(10000),
          },
        ],
      }),
    )
    expect(await balance(t, t.skuA)).toEqual({ qty: '10', value: 100000 })
  })

  it('return: KEMBALI_STOK 1 of 7 → +8208 (BR-HPP-007 formula with the kernel); BUANG without movement; the final return takes the remaining 3,334', async () => {
    const t = await setupInventoryTenant('vr-ret')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await receive(t, t.skuA, '113', 927542)
    const line7 = idGen.newId()
    await withTenant(t.tenantId, (tx) =>
      applySaleStock(tx, {
        tenantId: t.tenantId,
        outletId: t.outletA,
        saleId: idGen.newId(),
        occurredAt: '2026-11-20T10:00:00.000Z',
        businessDate: '2026-11-20',
        processedAt: '2026-11-20T10:00:00.000Z',
        commandId: null,
        actorId: t.actorUserId,
        lines: [{ lineId: line7, lineNo: 1, lineKind: 'ITEM', skuId: t.skuA, qtyBase: parseQty('7') }],
      }),
    )
    const one = await withTenant(t.tenantId, (tx) =>
      applyReturnStock(tx, {
        tenantId: t.tenantId,
        outletId: t.outletA,
        occurredAt: '2026-11-20T11:00:00.000Z',
        businessDate: '2026-11-20',
        processedAt: '2026-11-20T11:00:00.000Z',
        commandId: null,
        actorId: t.actorUserId,
        lines: [
          {
            creditNoteLineId: idGen.newId(),
            lineNo: 1,
            saleLineId: line7,
            skuId: t.skuA,
            disposition: 'KEMBALI_STOK',
            qtyReturnedBase: parseQty('1'),
            saleQtyBase: parseQty('7'),
            costSnapshot: toMoney(57458),
            returnedQtyBefore: parseQty('0'),
            costReturnedBefore: toMoney(0),
          },
        ],
      }),
    )
    expect(one.lines[0]!.costReturned).toBe(8208)
    expect(await balance(t, t.skuA)).toEqual({ qty: '107', value: 878292 })

    const buang = await withTenant(t.tenantId, (tx) =>
      applyReturnStock(tx, {
        tenantId: t.tenantId,
        outletId: t.outletA,
        occurredAt: '2026-11-20T11:30:00.000Z',
        businessDate: '2026-11-20',
        processedAt: '2026-11-20T11:30:00.000Z',
        commandId: null,
        actorId: t.actorUserId,
        lines: [
          {
            creditNoteLineId: idGen.newId(),
            lineNo: 1,
            saleLineId: line7,
            skuId: t.skuA,
            disposition: 'BUANG',
            qtyReturnedBase: parseQty('1'),
            saleQtyBase: parseQty('7'),
            costSnapshot: toMoney(57458),
            returnedQtyBefore: parseQty('1'),
            costReturnedBefore: toMoney(8208),
          },
        ],
      }),
    )
    expect(buang.lines[0]!.costReturned).toBeNull()
    expect(await balance(t, t.skuA)).toEqual({ qty: '107', value: 878292 })
  })

  it('cumulative returns never exceed the original COGS: 3 pcs @ COGS 10000 → 3333 / 3333 / 3334', async () => {
    const t = await setupInventoryTenant('vr-rem')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await receive(t, t.skuA, '3', 10000)
    const line = idGen.newId()
    await withTenant(t.tenantId, (tx) =>
      applySaleStock(tx, {
        tenantId: t.tenantId,
        outletId: t.outletA,
        saleId: idGen.newId(),
        occurredAt: '2026-11-20T10:00:00.000Z',
        businessDate: '2026-11-20',
        processedAt: '2026-11-20T10:00:00.000Z',
        commandId: null,
        actorId: t.actorUserId,
        lines: [{ lineId: line, lineNo: 1, lineKind: 'ITEM', skuId: t.skuA, qtyBase: parseQty('3') }],
      }),
    )
    let beforeQty = '0'
    let beforeCost = 0
    const costs: number[] = []
    for (let i = 0; i < 3; i += 1) {
      const r = await withTenant(t.tenantId, (tx) =>
        applyReturnStock(tx, {
          tenantId: t.tenantId,
          outletId: t.outletA,
          occurredAt: '2026-11-20T11:00:00.000Z',
          businessDate: '2026-11-20',
          processedAt: `2026-11-20T11:0${i}:00.000Z`,
          commandId: null,
          actorId: t.actorUserId,
          lines: [
            {
              creditNoteLineId: idGen.newId(),
              lineNo: 1,
              saleLineId: line,
              skuId: t.skuA,
              disposition: 'KEMBALI_STOK',
              qtyReturnedBase: parseQty('1'),
              saleQtyBase: parseQty('3'),
              costSnapshot: toMoney(10000),
              returnedQtyBefore: parseQty(beforeQty),
              costReturnedBefore: toMoney(beforeCost),
            },
          ],
        }),
      )
      const c = r.lines[0]!.costReturned!
      costs.push(c)
      beforeQty = String(Number(beforeQty) + 1)
      beforeCost += c
    }
    expect(costs).toEqual([3333, 3333, 3334])
    expect(beforeCost).toBe(10000)
  })
})
