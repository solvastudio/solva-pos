import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closePools, withTenant } from '~/server/db'
import { applyMovements } from '~/modules/inventory/public'
import { createIdGenerator, parseQty, toMoney } from '~/lib/kernel'
import { setupInventoryTenant } from './helpers/inventory'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    globalThis.crypto.getRandomValues(b)
    return b[0]!
  },
})

describe('inventory grants & immutability (AD-13, SCHEMA §5.5)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('solva_app cannot UPDATE or DELETE stock_movement (privilege + trigger)', async () => {
    const t = await setupInventoryTenant('grant-mov')
    await withTenant(t.tenantId, (tx) =>
      applyMovements(tx, { tenantId: t.tenantId, processedAt: new Date().toISOString() }, [
        {
          outletId: t.outletA,
          skuId: t.skuA,
          kind: 'IN',
          qty: parseQty('5'),
          valueIn: toMoney(5000),
          movementType: 'GR_IN',
          sourceType: 'GR_LINE',
          sourceId: idGen.newId(),
          occurredAt: '2026-11-20T08:00:00.000Z',
          businessDate: '2026-11-20',
          order: 1,
        },
      ]),
    )
    await expect(
      withTenant(t.tenantId, (tx) => tx.execute(sql`UPDATE stock_movement SET value_delta = 0 WHERE tenant_id = ${t.tenantId}`)),
    ).rejects.toThrow()
    await expect(
      withTenant(t.tenantId, (tx) => tx.execute(sql`DELETE FROM stock_movement WHERE tenant_id = ${t.tenantId}`)),
    ).rejects.toThrow()
  })

  it('goods_receipt: key column (doc_no) cannot be changed by solva_app after creation', async () => {
    const t = await setupInventoryTenant('grant-gr')
    await withTenant(t.tenantId, (tx) =>
      tx.execute(sql`
        INSERT INTO goods_receipt (id, tenant_id, outlet_id, doc_no, status, business_date, created_by)
        VALUES (${idGen.newId()}, ${t.tenantId}, ${t.outletA}, 'GR-OUT01-1126-0001', 'DRAFT', '2026-11-20', ${t.actorUserId})`),
    )
    await expect(
      withTenant(t.tenantId, (tx) =>
        tx.execute(sql`UPDATE goods_receipt SET doc_no = 'GR-X' WHERE tenant_id = ${t.tenantId}`),
      ),
    ).rejects.toThrow()
  })
})
