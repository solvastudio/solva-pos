import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createIdGenerator, parseQty, toMoney } from '~/lib/kernel'
import { applySaleStock } from '~/modules/inventory/public'
import { createPairingCode, createRegister, enrollDevice } from '~/modules/identity/public'
import { handlePull, type PullRequestMeta } from '~/modules/sync/server/pull.service'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { enableOutletInventory, setupInventoryTenant } from './helpers/inventory'
import { applyMovements } from '~/modules/inventory/public'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

const META: PullRequestMeta = { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: 'snap' }

describe('stock snapshot to the POS through pull (BR-STK-005, FR-INV-003)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('stock block only on the last page; same etag → unchanged; a new movement changes the etag and qty', async () => {
    resetEnvForTests()
    resetCompositionForTests()
    composeServer()

    const t = await setupInventoryTenant('snap')
    await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
    await withTenant(t.tenantId, (tx) =>
      applyMovements(tx, { tenantId: t.tenantId, processedAt: '2026-11-20T09:00:00.000Z' }, [
        {
          outletId: t.outletA,
          skuId: t.skuA,
          kind: 'IN',
          qty: parseQty('10'),
          valueIn: toMoney(100000),
          movementType: 'GR_IN',
          sourceType: 'GR_LINE',
          sourceId: idGen.newId(),
          occurredAt: '2026-11-20T09:00:00.000Z',
          businessDate: '2026-11-20',
          order: 1,
        },
      ]),
    )

    const reg = await createRegister(t.actor, {
      outletId: t.outletA,
      code: 'POS01',
      name: 'POS 01',
      registerType: 'CASHIER',
      invoicePrefix: 'OUT01-POS01',
    })
    const pairing = await createPairingCode(t.actor, reg.id)
    const dev = await enrollDevice({ slug: t.slug, code: pairing.code, device_name: 'POS-SNAP' }, '10.70.0.1', {
      minDelayMs: 0,
    })
    const device = {
      tenantId: t.tenantId,
      deviceId: dev.device_id,
      registerId: reg.id,
      outletId: t.outletA,
      registerType: 'CASHIER' as const,
    }

    const first = await handlePull(device, { cursor: null, cycle: null, page_size: 500, attention_ids: [], stock_etag: null }, META)
    if (!('stock' in first) || first.stock === undefined || first.stock === 'unchanged') {
      throw new Error('blok stock tidak ada pada halaman terakhir pertama')
    }
    expect(first.stock.rows).toEqual([{ sku_id: t.skuA, qty: '10' }])
    expect(first.stock.acked_device_seq).toBe(0)
    expect(first.stock.etag).toMatch(/^[0-9a-f]{16}$/)

    const same = await handlePull(
      device,
      { cursor: null, cycle: null, page_size: 500, attention_ids: [], stock_etag: first.stock.etag },
      META,
    )
    expect('stock' in same && same.stock).toBe('unchanged')

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
        lines: [{ lineId: idGen.newId(), lineNo: 1, lineKind: 'ITEM', skuId: t.skuA, qtyBase: parseQty('2') }],
      }),
    )

    const changed = await handlePull(
      device,
      { cursor: null, cycle: null, page_size: 500, attention_ids: [], stock_etag: first.stock.etag },
      META,
    )
    if (!('stock' in changed) || changed.stock === undefined || changed.stock === 'unchanged') {
      throw new Error('blok stock seharusnya dikirim setelah movement')
    }
    expect(changed.stock.etag).not.toBe(first.stock.etag)
    expect(changed.stock.rows).toEqual([{ sku_id: t.skuA, qty: '8' }])

    const probe = await withTenant(t.tenantId, async (tx) => {
      const r = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM stock_balance WHERE tenant_id = ${t.tenantId}`)
      return Number(r.rows[0]!.n)
    })
    expect(probe).toBe(1)
  }, 60_000)
})
