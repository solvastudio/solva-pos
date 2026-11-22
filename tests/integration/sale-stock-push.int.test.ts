import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { type PushCommandEnvelope } from '~/lib/contracts'
import { createIdGenerator, parseQty, toMoney } from '~/lib/kernel'
import { applyMovements } from '~/modules/inventory/public'
import {
  createInvite,
  listRolesWithPermissions,
  redeemInvite,
  getTenantAuthMetadataBySlug,
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  createPairingCode,
  createRegister,
  enrollDevice,
} from '~/modules/identity/public'
import { processPush, type SyncDeviceIdentity } from '~/modules/sync/public'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { closePools, withTenant } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { enableOutletInventory, setupInventoryTenant, type InventoryTenant } from './helpers/inventory'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

const META = { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: 'sp-meta' }

interface PushFixture {
  readonly t: InventoryTenant
  readonly dev: SyncDeviceIdentity
  readonly shiftId: string
  readonly legalEntityId: string
  readonly productId: string
  readonly cashMethodId: string
  readonly approverUserId: string
}

async function fixture(prefix: string): Promise<PushFixture> {
  const t = await setupInventoryTenant(prefix)
  await enableOutletInventory(t.tenantId, t.outletA, '2026-11-01T00:00:00.000Z')
  await withTenant(t.tenantId, (tx) =>
    applyMovements(tx, { tenantId: t.tenantId, processedAt: '2026-11-20T09:00:00.000Z' }, [
      {
        outletId: t.outletA,
        skuId: t.skuA,
        kind: 'IN',
        qty: parseQty('10'),
        valueIn: toMoney(60000),
        movementType: 'GR_IN',
        sourceType: 'GR_LINE',
        sourceId: idGen.newId(),
        occurredAt: '2026-11-20T09:00:00.000Z',
        businessDate: '2026-11-20',
        order: 1,
      },
    ]),
  )

  // The void approver must be a different user (VoidSalePayloadV1: void_approved_by ≠ voided_by).
  const roles = await listRolesWithPermissions(t.actor)
  const managerRole = roles.find((r) => r.code === 'MANAGER')!
  const approverEmail = `mgr-${t.slug}@example.test`
  const invite = await createInvite(t.actor, { email: approverEmail, displayName: 'Manager', roleId: managerRole.id, outletIds: null })
  const meta = await getTenantAuthMetadataBySlug(t.slug)
  await redeemInvite({ tenantId: t.tenantId, tenantSlug: t.slug, authOrgId: meta!.authOrgId, email: approverEmail, code: invite.code, password: 'StaffPassword123!' })

  const reg = await createRegister(t.actor, {
    outletId: t.outletA,
    code: 'POS01',
    name: 'POS 01',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const pairing = await createPairingCode(t.actor, reg.id)
  const dev = await enrollDevice({ slug: t.slug, code: pairing.code, device_name: 'POS-INV' }, '10.60.0.1', {
    minDelayMs: 0,
  })
  const ids = await withTenant(t.tenantId, async (tx) => {
    const le = await tx.execute<{ id: string }>(sql`SELECT id FROM legal_entity WHERE tenant_id = ${t.tenantId} LIMIT 1`)
    const pm = await tx.execute<{ id: string }>(sql`SELECT id FROM payment_method WHERE tenant_id = ${t.tenantId} AND code = 'CASH' AND deleted_at IS NULL LIMIT 1`)
    const p = await tx.execute<{ product_id: string }>(sql`SELECT product_id FROM sku WHERE tenant_id = ${t.tenantId} AND id = ${t.skuA}`)
    return { legalEntityId: le.rows[0]!.id, cashMethodId: pm.rows[0]!.id, productId: p.rows[0]!.product_id }
  })

  const dev2: SyncDeviceIdentity = {
    tenantId: t.tenantId,
    deviceId: dev.device_id,
    registerId: reg.id,
    outletId: t.outletA,
    registerType: 'CASHIER',
  }
  const shiftId = idGen.newId()
  await processPush(
    dev2,
    {
      sent_at_device: new Date().toISOString(),
      clock_offset_ms: 0,
      commands: [
        {
          id: shiftId,
          type: 'OpenShift',
          schema_version: 1,
          device_seq: 1,
          depends_on: [],
          created_at_device: '2026-11-20T08:00:00.000Z',
          payload: {
            shift: {
              id: shiftId,
              created_by: t.actorUserId,
              created_at_device: '2026-11-20T08:00:00.000Z',
              clock_offset_ms: 0,
              occurred_at: '2026-11-20T08:00:00.000Z',
              business_date: '2026-11-20',
              opening_cash: 0,
            },
          },
        },
      ],
    },
    META,
  )
  return { t, dev: dev2, shiftId, approverUserId: invite.appUserId, ...ids }
}

function saleCommand(f: PushFixture, saleId: string, deviceSeq: number, qty: string): PushCommandEnvelope {
  const lineId = idGen.newId()
  return {
    id: saleId,
    type: 'FinalizeSale',
    schema_version: 1,
    device_seq: deviceSeq,
    depends_on: [],
    created_at_device: '2026-11-20T10:00:00.000Z',
    payload: {
      sale: {
        id: saleId,
        shift_id: f.shiftId,
        created_by: f.t.actorUserId,
        created_at_device: '2026-11-20T10:00:00.000Z',
        clock_offset_ms: 0,
        occurred_at: '2026-11-20T10:00:00.000Z',
        business_date: '2026-11-20',
        invoice_no: `OUT01-POS01-1126-${String(deviceSeq).padStart(6, '0')}`,
        invoice_prefix: 'OUT01-POS01',
        invoice_period: '1126',
        invoice_seq: deviceSeq,
        legal_entity_id: f.legalEntityId,
        legal_entity_npwp: null,
        legal_entity_is_pkp: false,
        price_tax_mode: 'EXCLUSIVE',
        tax_profile: 'PPN',
        tax_rate: '11.0000',
        tax_rate_id: null,
        service_charge_rate: '0.0000',
        service_charge_taxable: true,
        cash_rounding_unit: 100,
        receipt_locale: 'id-ID',
        currency: 'IDR',
        gross_total: 10000,
        line_discount_total: 0,
        bill_discount_type: null,
        bill_discount_pct: null,
        bill_discount_input: null,
        bill_discount_total: 0,
        discount_approved_by: null,
        net_subtotal: 10000,
        service_charge: 0,
        tax_base: 10000,
        tax_amount: 1100,
        dpp: 10000,
        grand_total: 11100,
        rounding: 0,
        customer_name: null,
        customer_phone: null,
        catalog_cursor: 1,
        bill_id: null,
        bill_ref: null,
      },
      lines: [
        {
          id: lineId,
          line_no: 1,
          line_kind: 'ITEM',
          product_id: f.productId,
          sku_id: f.t.skuA,
          uom_id: f.t.pcsUomId,
          sku_code: 'INV-A',
          item_name: 'INV-A',
          uom_code: 'pcs',
          qty,
          conversion_factor: '1.0000',
          qty_base: qty,
          unit_price: 10000,
          price_source: 'OUTLET',
          is_open_price: false,
          taxable: true,
          discount_type: null,
          discount_pct: null,
          discount_input: null,
          discount_approved_by: null,
          line_gross: 10000,
          line_discount: 0,
          line_net: 10000,
          bill_discount_alloc: 0,
          service_alloc: 0,
          tax_alloc: 1100,
          note: null,
          source_bill_item_id: null,
          modifiers: [],
        },
      ],
      payments: [
        {
          id: idGen.newId(),
          seq: 1,
          method_id: f.cashMethodId,
          method_code: 'CASH',
          method_name: 'Tunai',
          method_kind: 'CASH',
          amount_applied: 11100,
          cash_tendered: 20000,
          change_given: 8900,
          reference: null,
          is_rounding_settler: true,
        },
      ],
    },
  }
}

describe('FinalizeSale & VoidSale through the sync pipeline (ACK cost_total, SALE_VOID)', () => {
  afterAll(async () => {
    await closePools()
  })

  it('ACK carries cost_total and cost_snapshot per line; VoidSale creates SALE_VOID', async () => {
    resetEnvForTests()
    __clearTenantCacheForTests()
    __clearDeviceAuthCacheForTests()
    resetLimitersForTests()
    __resetPushLimitsForTests()
    resetCompositionForTests()
    composeServer()

    const f = await fixture('sp-ack')
    const saleId = idGen.newId()
    const push = await processPush(
      f.dev,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [saleCommand(f, saleId, 2, '1')] },
      META,
    )
    expect(push.results[0], 'push FinalizeSale').toMatchObject({ outcome: 'ACK' })
    const first = push.results[0]!
    const ack = (first.outcome === 'ACK' ? first.result : {}) as Record<string, unknown>
    expect(ack.cost_total).toBe(6000)
    expect(ack.lines).toEqual([{ line_no: 1, cost_snapshot: 6000 }])

    const voidCmd: PushCommandEnvelope = {
      id: idGen.newId(),
      type: 'VoidSale',
      schema_version: 1,
      device_seq: 3,
      depends_on: [saleId],
      created_at_device: '2026-11-20T10:10:00.000Z',
      payload: {
        sale_id: saleId,
        voided_at: '2026-11-20T10:10:00.000Z',
        voided_by: f.t.actorUserId,
        void_approved_by: f.approverUserId,
        reason_code: 'MISTAKE',
        reason_text: 'Uji stok',
      },
    }
    const voided = await processPush(
      f.dev,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [voidCmd] },
      META,
    )
    expect(voided.results[0], 'push VoidSale').toMatchObject({ outcome: 'ACK' })

    const types = await withTenant(f.t.tenantId, async (tx) => {
      const r = await tx.execute<{ movement_type: string; cost_basis: string }>(sql`
        SELECT movement_type, cost_basis FROM stock_movement WHERE tenant_id = ${f.t.tenantId} AND sku_id = ${f.t.skuA} ORDER BY bal_seq`)
      return r.rows.map((x) => x.movement_type)
    })
    expect(types).toEqual(['GR_IN', 'SALE', 'SALE_VOID'])
  }, 60_000)

  it('lock_timeout while a balance lock is held: command answered RETRY (not ATTENTION) and no sale written', async () => {
    resetEnvForTests()
    __clearTenantCacheForTests()
    __clearDeviceAuthCacheForTests()
    resetLimitersForTests()
    __resetPushLimitsForTests()
    resetCompositionForTests()
    composeServer()

    const f = await fixture('sp-lock')
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const holder = withTenant(f.t.tenantId, async (tx) => {
      await tx.execute(sql`SELECT 1 FROM stock_balance WHERE tenant_id = ${f.t.tenantId} AND sku_id = ${f.t.skuA} FOR UPDATE`)
      await held
    })
    await new Promise((r) => setTimeout(r, 200))

    const saleId = idGen.newId()
    const push = await processPush(
      f.dev,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [saleCommand(f, saleId, 2, '1')] },
      META,
    )
    release()
    await holder

    expect(push.results[0], 'push saat kunci ditahan').toMatchObject({ outcome: 'RETRY' })
    const sales = await withTenant(f.t.tenantId, async (tx) => {
      const r = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM sale WHERE tenant_id = ${f.t.tenantId}`)
      return Number(r.rows[0]!.n)
    })
    expect(sales).toBe(0)
  }, 60_000)
})
