import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { type PushCommandEnvelope } from '~/lib/contracts'
import { createIdGenerator, formatInvoiceNo, invoicePeriod, parseQty, toMoney } from '~/lib/kernel'
import { calcSale } from '~/lib/sales-calc'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  getTenantAuthMetadataBySlug,
  redeemInvite,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { processPush, type SyncDeviceIdentity } from '~/modules/sync/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { masterTx } from './helpers/master'
import { uniqueSlug } from './helpers/tenants'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: idGen.newId(), email: 'op-void@example.test' }

async function setupVoidEnv(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Void ${slug}`,
    slug,
    ownerEmail: email,
    ownerDisplayName: 'Owner',
  })
  const meta = await getTenantAuthMetadataBySlug(slug)
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email,
    code: created.ownerInvite.code,
    password: 'OwnerPassword123!',
  })
  const actor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }
  const le = await createLegalEntity(actor, { name: 'PT Void', isPkp: false })
  const outlet = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })
  const reg = await createRegister(actor, {
    outletId: outlet.id,
    code: 'POS01',
    name: 'POS 1',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const p = await createPairingCode(actor, reg.id)
  const dev = await enrollDevice({ slug, code: p.code, device_name: 'Dev1' }, '10.8.0.1', { minDelayMs: 0 })

  const seeded = await masterTx(created.tenantId, async (c, v) => {
    const supId = (
      await c.query<{ id: string }>(
        `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Sup Void') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id
    const catId = (
      await c.query<{ id: string }>(
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Cat') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id
    const pcsId = (
      await c.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pcs') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id
    const prodId = (
      await c.query<{ id: string }>(
        `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id) VALUES ($1, $2, $3, 'P1', 'Prod', $4) RETURNING id`,
        [created.tenantId, v, catId, pcsId],
      )
    ).rows[0]!.id
    const skuId = (
      await c.query<{ id: string }>(
        `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES ($1, $2, $3, 'SKU1', true) RETURNING id`,
        [created.tenantId, v, prodId],
      )
    ).rows[0]!.id
    const cashRow = await c.query<{ id: string }>(
      `SELECT id FROM payment_method WHERE tenant_id = $1 AND code = 'CASH' AND deleted_at IS NULL LIMIT 1`,
      [created.tenantId],
    )
    const cashMethodId =
      cashRow.rows[0]?.id ??
      (
        await c.query<{ id: string }>(
          `INSERT INTO payment_method (tenant_id, version, code, name, kind) VALUES ($1, $2, 'CASH', 'Tunai', 'CASH') RETURNING id`,
          [created.tenantId, v],
        )
      ).rows[0]!.id
    return { supId, pcsId, prodId, skuId, cashMethodId, version: v }
  })

  const syncDevice: SyncDeviceIdentity = {
    tenantId: created.tenantId,
    deviceId: dev.device_id,
    registerId: reg.id,
    outletId: outlet.id,
    registerType: 'CASHIER',
  }

  return { tenantId: created.tenantId, actor, le, outlet, reg, syncDevice, ...seeded }
}

describe('VoidSale command integration (BR-INV-005, HELD dependency, shift recap)', () => {
  beforeEach(() => {
    resetEnvForTests()
    __clearTenantCacheForTests()
    __clearDeviceAuthCacheForTests()
    resetLimitersForTests()
    __resetPushLimitsForTests()
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    await closePools()
  })

  it('keeps invoice number, decrements closed shift cash, handles HELD before FinalizeSale, and replays idempotently', async () => {
    const env = await setupVoidEnv(uniqueSlug('void-sale'))
    const shiftId = idGen.newId()
    const saleId = idGen.newId()

    await processPush(
      env.syncDevice,
      {
        sent_at_device: '2026-11-20T08:00:00.000Z',
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
                created_by: env.actor.appUserId,
                created_at_device: '2026-11-20T08:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T08:00:00.000Z',
                business_date: '2026-11-20',
                opening_cash: 200_000,
              },
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'v-open' },
    )

    // VoidSale arriving BEFORE FinalizeSale (depends_on: [saleId]) -> HELD
    const voidCmd: PushCommandEnvelope = {
      id: idGen.newId(),
      type: 'VoidSale',
      schema_version: 1,
      device_seq: 3,
      depends_on: [saleId],
      created_at_device: '2026-11-20T10:15:00.000Z',
      payload: {
        sale_id: saleId,
        voided_at: '2026-11-20T10:15:00.000Z',
        voided_by: env.actor.appUserId,
        void_approved_by: env.supId,
        reason_code: 'MISTAKE',
        reason_text: 'Customer canceled',
      },
    }
    const rHeld = await processPush(
      env.syncDevice,
      { sent_at_device: '2026-11-20T10:15:00.000Z', clock_offset_ms: 0, commands: [voidCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'v-held' },
    )
    expect(rHeld.results[0]!.outcome).toBe('HELD')

    // Now FinalizeSale (50,000 cash) arrives + CloseShift -> expected_cash = 250,000
    const calc = calcSale({
      lines: [
        { lineNo: 1, skuId: env.skuId, uomId: env.pcsId, qty: parseQty('1'), unitPrice: toMoney(50_000), taxable: false },
      ],
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'NONE',
        taxRate: '0.0000',
        serviceChargeEnabled: false,
        serviceChargeRate: '0.0000',
        serviceChargeTaxable: true,
      },
    })
    const period = invoicePeriod('2026-11-20')
    const invoiceNo = formatInvoiceNo({ prefix: 'OUT01-POS01', kind: 'INVOICE', period, seq: 1 })
    const saleCmd: PushCommandEnvelope = {
      id: saleId,
      type: 'FinalizeSale',
      schema_version: 1,
      device_seq: 2,
      depends_on: [shiftId],
      created_at_device: '2026-11-20T10:00:00.000Z',
      payload: {
        sale: {
          id: saleId,
          shift_id: shiftId,
          created_by: env.actor.appUserId,
          created_at_device: '2026-11-20T10:00:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-20T10:00:00.000Z',
          business_date: '2026-11-20',
          invoice_no: invoiceNo,
          invoice_prefix: 'OUT01-POS01',
          invoice_period: period,
          invoice_seq: 1,
          legal_entity_id: env.le.id,
          legal_entity_npwp: null,
          legal_entity_is_pkp: false,
          price_tax_mode: 'EXCLUSIVE',
          tax_profile: 'NONE',
          tax_rate: '0.0000',
          tax_rate_id: null,
          service_charge_rate: '0.0000',
          service_charge_taxable: true,
          cash_rounding_unit: 0,
          receipt_locale: 'id-ID',
          currency: 'IDR',
          gross_total: calc.grossTotal,
          line_discount_total: 0,
          bill_discount_type: null,
          bill_discount_pct: null,
          bill_discount_input: null,
          bill_discount_total: 0,
          discount_approved_by: null,
          net_subtotal: calc.netSubtotal,
          service_charge: 0,
          tax_base: 0,
          tax_amount: 0,
          dpp: 0,
          grand_total: calc.grandTotal,
          rounding: 0,
          customer_name: null,
          customer_phone: null,
          catalog_cursor: env.version,
          bill_id: null,
          bill_ref: null,
        },
        lines: [
          {
            id: idGen.newId(),
            line_no: 1,
            line_kind: 'ITEM',
            product_id: env.prodId,
            sku_id: env.skuId,
            uom_id: env.pcsId,
            sku_code: 'SKU1',
            item_name: 'Prod',
            uom_code: 'PCS',
            qty: '1.0000',
            conversion_factor: '1.0000',
            qty_base: '1.0000',
            unit_price: 50_000,
            price_source: 'OUTLET',
            is_open_price: false,
            taxable: false,
            discount_type: null,
            discount_pct: null,
            discount_input: null,
            discount_approved_by: null,
            line_gross: 50_000,
            line_discount: 0,
            line_net: 50_000,
            bill_discount_alloc: 0,
            service_alloc: 0,
            tax_alloc: 0,
            note: null,
            source_bill_item_id: null,
          },
        ],
        payments: [
          {
            id: idGen.newId(),
            seq: 1,
            method_id: env.cashMethodId,
            method_code: 'CASH',
            method_name: 'Tunai',
            method_kind: 'CASH',
            amount_applied: 50_000,
            cash_tendered: 50_000,
            change_given: 0,
            reference: null,
            is_rounding_settler: false,
          },
        ],
      },
    }
    const closeCmd: PushCommandEnvelope = {
      id: idGen.newId(),
      type: 'CloseShift',
      schema_version: 1,
      device_seq: 4,
      depends_on: [shiftId],
      created_at_device: '2026-11-20T21:00:00.000Z',
      payload: {
        shift_id: shiftId,
        counted_cash: 200_000,
        count_submitted_at: '2026-11-20T21:00:00.000Z',
        closed_at: '2026-11-20T21:01:00.000Z',
        closed_at_device: '2026-11-20T21:01:00.000Z',
        expected_cash_device: 200_000,
        variance_device: 0,
        close_note: null,
      },
    }

    await processPush(
      env.syncDevice,
      { sent_at_device: '2026-11-20T21:02:00.000Z', clock_offset_ms: 0, commands: [saleCmd, closeCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'v-sale-close' },
    )

    // Retry VoidSale now that FinalizeSale ACKed -> ACK, invoice_no retained, shift expected_cash back to 200,000!
    const rVoid = await processPush(
      env.syncDevice,
      { sent_at_device: '2026-11-20T21:03:00.000Z', clock_offset_ms: 0, commands: [voidCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'v-void-ok' },
    )
    expect(rVoid.results[0]).toEqual({
      id: voidCmd.id,
      outcome: 'ACK',
      result: { sale_id: saleId, status: 'VOID' },
    })

    // Replay idempotently
    const rVoidReplay = await processPush(
      env.syncDevice,
      { sent_at_device: '2026-11-20T21:04:00.000Z', clock_offset_ms: 0, commands: [voidCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'v-void-rep' },
    )
    expect(rVoidReplay.results[0]).toEqual(rVoid.results[0])

    await withTenant(env.tenantId, async (tx) => {
      const sRow = await tx.execute(`SELECT status, invoice_no FROM sale WHERE id = '${saleId}'`)
      expect(sRow.rows[0]!.status).toBe('VOID')
      expect(sRow.rows[0]!.invoice_no).toBe(invoiceNo)

      const shRow = await tx.execute(`SELECT expected_cash, recap_cash_sales FROM cash_cashier WHERE id = '${shiftId}'`)
      expect(Number(shRow.rows[0]!.expected_cash)).toBe(200_000)
      expect(Number(shRow.rows[0]!.recap_cash_sales)).toBe(0)
    })

    // Approver == voided_by rejected at Zod layer
    const selfApproveCmd: PushCommandEnvelope = {
      id: idGen.newId(),
      type: 'VoidSale',
      schema_version: 1,
      device_seq: 5,
      depends_on: [],
      created_at_device: '2026-11-20T21:05:00.000Z',
      payload: {
        sale_id: saleId,
        voided_at: '2026-11-20T21:05:00.000Z',
        voided_by: env.actor.appUserId,
        void_approved_by: env.actor.appUserId,
        reason_code: 'SELF',
        reason_text: 'Self approve not allowed',
      },
    }
    const rSelf = await processPush(
      env.syncDevice,
      { sent_at_device: '2026-11-20T21:05:00.000Z', clock_offset_ms: 0, commands: [selfApproveCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'v-self' },
    )
    expect(rSelf.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'VALIDATION_FAILED',
    })
  })
})
