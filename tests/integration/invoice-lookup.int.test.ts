import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
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
import { handleGetInvoice } from '~/routes/api/pos/v1/invoice'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
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

const testOp = { platformUserId: idGen.newId(), email: 'op-inv-lookup@example.test' }

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

describe('GET /api/pos/v1/invoice (invoice lookup for remote returns)', () => {
  it('returns same-outlet invoice with cumulative returns across 2 NK, 404 for other outlet, VOID status, and 401 without Bearer', async () => {
    const slug = uniqueSlug('inv-lk')
    const email = `owner-${slug}@example.test`
    const created = await createTenant(testOp, {
      name: `Lookup ${slug}`,
      slug,
      ownerEmail: email,
      ownerDisplayName: 'Owner',
    })
    const tenantId = created.tenantId
    const meta = await getTenantAuthMetadataBySlug(slug)
    await redeemInvite({
      tenantId,
      tenantSlug: slug,
      authOrgId: meta!.authOrgId,
      email,
      code: created.ownerInvite.code,
      password: 'OwnerPassword123!',
    })
    const actor: IdentityAuthActor = {
      tenantId,
      tenantSlug: slug,
      authOrgId: meta!.authOrgId,
      appUserId: created.ownerInvite.appUserId,
      permissions: new Set(PERMISSION_CODES),
      outletIds: null,
      roleCodes: ['OWNER'],
    }
    const le = await createLegalEntity(actor, { name: 'PT Lookup', isPkp: false })
    const outletA = await createOutlet(actor, {
      legalEntityId: le.id,
      code: 'OUT1',
      name: 'Outlet 1',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '04:00',
      priceTaxMode: 'EXCLUSIVE',
    })
    const outletB = await createOutlet(actor, {
      legalEntityId: le.id,
      code: 'OUT2',
      name: 'Outlet 2',
      timezone: 'Asia/Jakarta',
      dayCutoffTime: '04:00',
      priceTaxMode: 'EXCLUSIVE',
    })
    const regA1 = await createRegister(actor, {
      outletId: outletA.id,
      code: 'POS01',
      name: 'Kasir A1',
      registerType: 'CASHIER',
      invoicePrefix: 'OUT01-POS01',
    })
    const regB1 = await createRegister(actor, {
      outletId: outletB.id,
      code: 'POS01',
      name: 'Kasir B1',
      registerType: 'CASHIER',
      invoicePrefix: 'OUT02-POS01',
    })

    const pairA = await createPairingCode(actor, regA1.id)
    const devA = await enrollDevice({ slug, code: pairA.code, device_name: 'Dev A' }, '10.8.0.1', {
      minDelayMs: 0,
    })
    const pairB = await createPairingCode(actor, regB1.id)
    const devB = await enrollDevice({ slug, code: pairB.code, device_name: 'Dev B' }, '10.8.0.2', {
      minDelayMs: 0,
    })

    const seeded = await masterTx(tenantId, async (c, v) => {
      const supId = (
        await c.query<{ id: string }>(
          `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Sup') RETURNING id`,
          [tenantId, v],
        )
      ).rows[0]!.id
      const catId = (
        await c.query<{ id: string }>(
          `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Cat') RETURNING id`,
          [tenantId, v],
        )
      ).rows[0]!.id
      const pcsId = (
        await c.query<{ id: string }>(
          `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pcs') RETURNING id`,
          [tenantId, v],
        )
      ).rows[0]!.id
      const prodId = (
        await c.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id) VALUES ($1, $2, $3, 'P1', 'Teh Botol', $4) RETURNING id`,
          [tenantId, v, catId, pcsId],
        )
      ).rows[0]!.id
      const skuId = (
        await c.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES ($1, $2, $3, 'TEA', true) RETURNING id`,
          [tenantId, v, prodId],
        )
      ).rows[0]!.id
      const cashRow = await c.query<{ id: string }>(
        `SELECT id FROM payment_method WHERE tenant_id = $1 AND code = 'CASH' AND deleted_at IS NULL LIMIT 1`,
        [tenantId],
      )
      const cashMethodId =
        cashRow.rows[0]?.id ??
        (
          await c.query<{ id: string }>(
            `INSERT INTO payment_method (tenant_id, version, code, name, kind) VALUES ($1, $2, 'CASH', 'Tunai', 'CASH') RETURNING id`,
            [tenantId, v],
          )
        ).rows[0]!.id
      return { supId, pcsId, prodId, skuId, cashMethodId }
    })

    const syncDeviceA: SyncDeviceIdentity = {
      tenantId,
      deviceId: devA.device_id,
      registerId: regA1.id,
      outletId: outletA.id,
      registerType: 'CASHIER',
    }

    const bDate = '2026-11-20'
    const period = invoicePeriod(bDate)
    const shiftA = idGen.newId()
    const saleAId = idGen.newId()
    const voidSaleAId = idGen.newId()
    const lineA1Id = idGen.newId()
    const invA = formatInvoiceNo({ prefix: 'OUT01-POS01', kind: 'INVOICE', period, seq: 1 })
    const invVoidA = formatInvoiceNo({ prefix: 'OUT01-POS01', kind: 'INVOICE', period, seq: 2 })

    const calc = calcSale({
      lines: [
        {
          lineNo: 1,
          skuId: seeded.skuId,
          uomId: seeded.pcsId,
          qty: parseQty('5'),
          unitPrice: toMoney(10_000),
          taxable: false,
        },
      ],
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'NONE',
        taxRate: '0',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      },
    })

    const pushRes = await processPush(
      syncDeviceA,
      {
        sent_at_device: '2026-11-20T05:10:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: shiftA,
            type: 'OpenShift',
            schema_version: 1,
            device_seq: 1,
            depends_on: [],
            created_at_device: '2026-11-20T01:00:00.000Z',
            payload: {
              shift: {
                id: shiftA,
                created_by: actor.appUserId,
                created_at_device: '2026-11-20T01:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T01:00:00.000Z',
                business_date: bDate,
                opening_cash: 100_000,
              },
            },
          },
          {
            id: saleAId,
            type: 'FinalizeSale',
            schema_version: 1,
            device_seq: 2,
            depends_on: [shiftA],
            created_at_device: '2026-11-20T02:00:00.000Z',
            payload: {
              sale: {
                id: saleAId,
                shift_id: shiftA,
                created_by: actor.appUserId,
                created_at_device: '2026-11-20T02:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T02:00:00.000Z',
                business_date: bDate,
                invoice_no: invA,
                invoice_prefix: 'OUT01-POS01',
                invoice_period: period,
                invoice_seq: 1,
                legal_entity_id: le.id,
                legal_entity_npwp: null,
                legal_entity_is_pkp: false,
                price_tax_mode: 'EXCLUSIVE',
                tax_profile: 'NONE',
                tax_rate: '0',
                tax_rate_id: null,
                service_charge_rate: '0',
                service_charge_taxable: true,
                cash_rounding_unit: 100,
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
                catalog_cursor: null,
                bill_id: null,
                bill_ref: null,
              },
              lines: [
                {
                  id: lineA1Id,
                  line_no: 1,
                  line_kind: 'ITEM',
                  product_id: seeded.prodId,
                  sku_id: seeded.skuId,
                  uom_id: seeded.pcsId,
                  sku_code: 'TEA',
                  item_name: 'Teh Botol',
                  uom_code: 'pcs',
                  qty: '5',
                  conversion_factor: '1',
                  qty_base: '5',
                  unit_price: 10_000,
                  price_source: 'TENANT_DEFAULT',
                  is_open_price: false,
                  taxable: false,
                  discount_type: null,
                  discount_pct: null,
                  discount_input: null,
                  discount_approved_by: null,
                  line_gross: calc.lines[0]!.lineGross,
                  line_discount: 0,
                  line_net: calc.lines[0]!.lineNet,
                  bill_discount_alloc: 0,
                  service_alloc: 0,
                  tax_alloc: 0,
                  note: null,
                  source_bill_item_id: null,
                  modifiers: [],
                },
              ],
              payments: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: seeded.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: 50_000,
                  cash_tendered: 50_000,
                  change_given: 0,
                  reference: null,
                  is_rounding_settler: true,
                },
              ],
            },
          },
          {
            id: idGen.newId(),
            type: 'FinalizeCreditNote',
            schema_version: 1,
            device_seq: 3,
            depends_on: [saleAId],
            created_at_device: '2026-11-20T03:00:00.000Z',
            payload: {
              credit_note: {
                id: idGen.newId(),
                shift_id: shiftA,
                created_by: actor.appUserId,
                approved_by: seeded.supId,
                created_at_device: '2026-11-20T03:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T03:00:00.000Z',
                business_date: bDate,
                cn_no: formatInvoiceNo({ prefix: 'OUT01-POS01', kind: 'CREDIT_NOTE', period, seq: 1 }),
                cn_prefix: 'OUT01-POS01',
                cn_period: period,
                cn_seq: 1,
                original_sale_id: saleAId,
                original_invoice_no: invA,
                reason_code: 'CUSTOMER_REQUEST',
                reason_text: null,
                price_tax_mode: 'EXCLUSIVE',
                cash_rounding_unit: 100,
                receipt_locale: 'id-ID',
                net_total: 10_000,
                service_total: 0,
                tax_total: 0,
                refund_gross: 10_000,
                rounding: 0,
              },
              lines: [
                {
                  id: idGen.newId(),
                  line_no: 1,
                  sale_line_id: lineA1Id,
                  qty_returned: '1',
                  qty_returned_base: '1',
                  refund_net: 10_000,
                  refund_service: 0,
                  refund_tax: 0,
                  is_final_return: false,
                  disposition: 'KEMBALI_STOK',
                },
              ],
              refunds: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: seeded.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: 10_000,
                  reference: null,
                },
              ],
            },
          },
          {
            id: idGen.newId(),
            type: 'FinalizeCreditNote',
            schema_version: 1,
            device_seq: 4,
            depends_on: [saleAId],
            created_at_device: '2026-11-20T04:00:00.000Z',
            payload: {
              credit_note: {
                id: idGen.newId(),
                shift_id: shiftA,
                created_by: actor.appUserId,
                approved_by: seeded.supId,
                created_at_device: '2026-11-20T04:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T04:00:00.000Z',
                business_date: bDate,
                cn_no: formatInvoiceNo({ prefix: 'OUT01-POS01', kind: 'CREDIT_NOTE', period, seq: 2 }),
                cn_prefix: 'OUT01-POS01',
                cn_period: period,
                cn_seq: 2,
                original_sale_id: saleAId,
                original_invoice_no: invA,
                reason_code: 'DAMAGED',
                reason_text: null,
                price_tax_mode: 'EXCLUSIVE',
                cash_rounding_unit: 100,
                receipt_locale: 'id-ID',
                net_total: 20_000,
                service_total: 0,
                tax_total: 0,
                refund_gross: 20_000,
                rounding: 0,
              },
              lines: [
                {
                  id: idGen.newId(),
                  line_no: 1,
                  sale_line_id: lineA1Id,
                  qty_returned: '2',
                  qty_returned_base: '2',
                  refund_net: 20_000,
                  refund_service: 0,
                  refund_tax: 0,
                  is_final_return: false,
                  disposition: 'KEMBALI_STOK',
                },
              ],
              refunds: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: seeded.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: 20_000,
                  reference: null,
                },
              ],
            },
          },
          {
            id: voidSaleAId,
            type: 'FinalizeSale',
            schema_version: 1,
            device_seq: 5,
            depends_on: [shiftA],
            created_at_device: '2026-11-20T05:00:00.000Z',
            payload: {
              sale: {
                id: voidSaleAId,
                shift_id: shiftA,
                created_by: actor.appUserId,
                created_at_device: '2026-11-20T05:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T05:00:00.000Z',
                business_date: bDate,
                invoice_no: invVoidA,
                invoice_prefix: 'OUT01-POS01',
                invoice_period: period,
                invoice_seq: 2,
                legal_entity_id: le.id,
                legal_entity_npwp: null,
                legal_entity_is_pkp: false,
                price_tax_mode: 'EXCLUSIVE',
                tax_profile: 'NONE',
                tax_rate: '0',
                tax_rate_id: null,
                service_charge_rate: '0',
                service_charge_taxable: true,
                cash_rounding_unit: 100,
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
                catalog_cursor: null,
                bill_id: null,
                bill_ref: null,
              },
              lines: [
                {
                  id: idGen.newId(),
                  line_no: 1,
                  line_kind: 'ITEM',
                  product_id: seeded.prodId,
                  sku_id: seeded.skuId,
                  uom_id: seeded.pcsId,
                  sku_code: 'TEA',
                  item_name: 'Teh Botol',
                  uom_code: 'pcs',
                  qty: '5',
                  conversion_factor: '1',
                  qty_base: '5',
                  unit_price: 10_000,
                  price_source: 'TENANT_DEFAULT',
                  is_open_price: false,
                  taxable: false,
                  discount_type: null,
                  discount_pct: null,
                  discount_input: null,
                  discount_approved_by: null,
                  line_gross: calc.lines[0]!.lineGross,
                  line_discount: 0,
                  line_net: calc.lines[0]!.lineNet,
                  bill_discount_alloc: 0,
                  service_alloc: 0,
                  tax_alloc: 0,
                  note: null,
                  source_bill_item_id: null,
                  modifiers: [],
                },
              ],
              payments: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: seeded.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: 50_000,
                  cash_tendered: 50_000,
                  change_given: 0,
                  reference: null,
                  is_rounding_settler: true,
                },
              ],
            },
          },
          {
            id: idGen.newId(),
            type: 'VoidSale',
            schema_version: 1,
            device_seq: 6,
            depends_on: [voidSaleAId],
            created_at_device: '2026-11-20T05:05:00.000Z',
            payload: {
              sale_id: voidSaleAId,
              voided_at: '2026-11-20T05:05:00.000Z',
              voided_by: actor.appUserId,
              void_approved_by: seeded.supId,
              reason_code: 'WRONG_INPUT',
              reason_text: 'Duplicate bill',
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'inv-lk-push' },
    )
    const nonAck = pushRes.results.filter((r) => r.outcome !== 'ACK')
    expect(nonAck).toEqual([])

    const unauthRes = await handleGetInvoice(
      new Request(`http://localhost/api/pos/v1/invoice?no=${invA}`),
    )
    expect(unauthRes.status).toBe(401)

    const okRes = await handleGetInvoice(
      new Request(`http://localhost/api/pos/v1/invoice?no=${invA}`, {
        headers: { authorization: `Bearer ${devA.credential}` },
      }),
    )
    expect(okRes.status).toBe(200)
    const okJson = (await okRes.json()) as {
      sale: { status: string }
      lines: Array<{ returned_so_far: { qty: string; net: number } }>
    }
    expect(okJson.sale.status).toBe('PAID')
    expect(okJson.lines[0]!.returned_so_far.qty).toBe('3')
    expect(okJson.lines[0]!.returned_so_far.net).toBe(30_000)

    const voidRes = await handleGetInvoice(
      new Request(`http://localhost/api/pos/v1/invoice?no=${invVoidA}`, {
        headers: { authorization: `Bearer ${devA.credential}` },
      }),
    )
    expect(voidRes.status).toBe(200)
    const voidJson = (await voidRes.json()) as { sale: { status: string } }
    expect(voidJson.sale.status).toBe('VOID')

    const crossOutletRes = await handleGetInvoice(
      new Request(`http://localhost/api/pos/v1/invoice?no=${invA}`, {
        headers: { authorization: `Bearer ${devB.credential}` },
      }),
    )
    expect(crossOutletRes.status).toBe(404)
  })
})
