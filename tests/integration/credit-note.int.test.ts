import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { type PushCommandEnvelope } from '~/lib/contracts'
import { createIdGenerator, formatInvoiceNo, invoicePeriod, parseQty, toMoney } from '~/lib/kernel'
import { calcAndSettle, calcCreditNote } from '~/lib/sales-calc'
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

const testOp = { platformUserId: idGen.newId(), email: 'op-cn@example.test' }

async function setupCnEnv(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `CN ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT CN', isPkp: true, npwp: '0123456789012345' })
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
  const dev = await enrollDevice({ slug, code: p.code, device_name: 'Dev1' }, '10.9.0.1', { minDelayMs: 0 })

  const seeded = await masterTx(created.tenantId, async (c, v) => {
    const supId = (
      await c.query<{ id: string }>(
        `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Sup CN') RETURNING id`,
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
        `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id) VALUES ($1, $2, $3, 'SUSU', 'Susu', $4) RETURNING id`,
        [created.tenantId, v, catId, pcsId],
      )
    ).rows[0]!.id
    const skuId = (
      await c.query<{ id: string }>(
        `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES ($1, $2, $3, 'SUSU-1', true) RETURNING id`,
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

function makeSaleEnvelope(
  env: Awaited<ReturnType<typeof setupCnEnv>>,
  opts: {
    saleId: string
    saleLineId: string
    shiftId: string
    deviceSeq: number
    businessDate: string
    occurredAt: string
    invoiceSeq: number
    qty: string
    unitPrice: number
  },
): PushCommandEnvelope {
  const { calc, settlement } = calcAndSettle(
    {
      lines: [
        {
          lineNo: 1,
          skuId: env.skuId,
          uomId: env.pcsId,
          qty: parseQty(opts.qty),
          unitPrice: toMoney(opts.unitPrice),
          taxable: true,
        },
      ],
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '0.1100',
        serviceChargeEnabled: false,
        serviceChargeRate: '0.0000',
        serviceChargeTaxable: true,
      },
    },
    [{ methodCode: 'CASH', kind: 'CASH', amount: toMoney(Math.round(opts.unitPrice * Number(opts.qty) * 1.11) + 1000) }],
    100,
  )
  const period = invoicePeriod(opts.businessDate)
  const invoiceNo = formatInvoiceNo({
    prefix: 'OUT01-POS01',
    kind: 'INVOICE',
    period,
    seq: opts.invoiceSeq,
  })
  const line = calc.lines[0]!
  const cashPay = settlement.payments[0]!
  return {
    id: opts.saleId,
    type: 'FinalizeSale',
    schema_version: 1,
    device_seq: opts.deviceSeq,
    depends_on: [opts.shiftId],
    created_at_device: opts.occurredAt,
    payload: {
      sale: {
        id: opts.saleId,
        shift_id: opts.shiftId,
        created_by: env.actor.appUserId,
        created_at_device: opts.occurredAt,
        clock_offset_ms: 0,
        occurred_at: opts.occurredAt,
        business_date: opts.businessDate,
        invoice_no: invoiceNo,
        invoice_prefix: 'OUT01-POS01',
        invoice_period: period,
        invoice_seq: opts.invoiceSeq,
        legal_entity_id: env.le.id,
        legal_entity_npwp: null,
        legal_entity_is_pkp: true,
        price_tax_mode: 'EXCLUSIVE',
        tax_profile: 'PPN',
        tax_rate: '0.1100',
        tax_rate_id: null,
        service_charge_rate: '0.0000',
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
        service_charge: calc.serviceCharge,
        tax_base: calc.taxBase,
        tax_amount: calc.taxAmount,
        dpp: calc.dpp,
        grand_total: calc.grandTotal,
        rounding: settlement.rounding,
        customer_name: null,
        customer_phone: null,
        catalog_cursor: env.version,
        bill_id: null,
        bill_ref: null,
      },
      lines: [
        {
          id: opts.saleLineId,
          line_no: 1,
          line_kind: 'ITEM',
          product_id: env.prodId,
          sku_id: env.skuId,
          uom_id: env.pcsId,
          sku_code: 'SUSU-1',
          item_name: 'Susu',
          uom_code: 'PCS',
          qty: `${opts.qty}.0000`,
          conversion_factor: '1.0000',
          qty_base: `${opts.qty}.0000`,
          unit_price: opts.unitPrice,
          price_source: 'OUTLET',
          is_open_price: false,
          taxable: true,
          discount_type: null,
          discount_pct: null,
          discount_input: null,
          discount_approved_by: null,
          line_gross: line.lineGross,
          line_discount: line.lineDiscount,
          line_net: line.lineNet,
          bill_discount_alloc: line.billDiscountAlloc,
          service_alloc: line.serviceAlloc,
          tax_alloc: line.taxAlloc,
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
          amount_applied: cashPay.applied,
          cash_tendered: cashPay.tendered,
          change_given: cashPay.change,
          reference: null,
          is_rounding_settler: true,
        },
      ],
    },
  }
}

describe('FinalizeCreditNote command integration (V-18, V-23, NK series, FOR UPDATE concurrency)', () => {
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

  it('verifies V-18 partial return rounding, cumulative qty enforcement, -Dn NK conflict, and SELISIH_HITUNG flag', async () => {
    const env = await setupCnEnv(uniqueSlug('cn-v18'))
    const shiftId = idGen.newId()
    const saleId = idGen.newId()
    const saleLineId = idGen.newId()

    const rSetup = await processPush(
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
                opening_cash: 100_000,
              },
            },
          },
          makeSaleEnvelope(env, {
            saleId,
            saleLineId,
            shiftId,
            deviceSeq: 2,
            businessDate: '2026-11-20',
            occurredAt: '2026-11-20T09:00:00.000Z',
            invoiceSeq: 1,
            qty: '3',
            unitPrice: 16_110, // V-18: 3 * 16,110 = 48,330 net + 5,316 tax (11% PPN EXCLUSIVE)
          }),
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-setup' },
    )
    expect(rSetup.results.map((r) => r.outcome)).toEqual(['ACK', 'ACK'])

    // V-18: Return 1 of 3 Susu (rounding 18 -> refundCashApplied 17,900)
    const cnCalc1 = calcCreditNote({
      lines: [
        {
          qtySold: parseQty('3'),
          qtyAlreadyReturned: parseQty('0'),
          qtyReturn: parseQty('1'),
          originalNet: toMoney(48_330),
          originalScAlloc: toMoney(0),
          originalTaxAlloc: toMoney(5_316),
          returnedSoFar: {
            net: toMoney(0),
            sc: toMoney(0),
            tax: toMoney(0),
          },
        },
      ],
      priceTaxMode: 'EXCLUSIVE',
      refund: { method: 'CASH', cashRoundingUnit: 100 },
    })
    expect(cnCalc1.netTotal).toBe(16_110)
    expect(cnCalc1.taxTotal).toBe(1_772)
    expect(cnCalc1.refundGross).toBe(17_882)
    expect(cnCalc1.rounding).toBe(18)
    expect(cnCalc1.refundCashApplied).toBe(17_900)

    const cnId1 = idGen.newId()
    const cnPeriod = invoicePeriod('2026-11-20')
    const cnNo1 = formatInvoiceNo({ prefix: 'OUT01-POS01', kind: 'CREDIT_NOTE', period: cnPeriod, seq: 1 })
    const lineCalc1 = cnCalc1.lines[0]!
    const rCn1 = await processPush(
      env.syncDevice,
      {
        sent_at_device: '2026-11-20T10:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: cnId1,
            type: 'FinalizeCreditNote',
            schema_version: 1,
            device_seq: 3,
            depends_on: [saleId],
            created_at_device: '2026-11-20T10:00:00.000Z',
            payload: {
              credit_note: {
                id: cnId1,
                shift_id: shiftId,
                created_by: env.actor.appUserId,
                approved_by: env.supId,
                created_at_device: '2026-11-20T10:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T10:00:00.000Z',
                business_date: '2026-11-20',
                cn_no: cnNo1,
                cn_prefix: 'OUT01-POS01',
                cn_period: cnPeriod,
                cn_seq: 1,
                original_sale_id: saleId,
                original_invoice_no: formatInvoiceNo({
                  prefix: 'OUT01-POS01',
                  kind: 'INVOICE',
                  period: cnPeriod,
                  seq: 1,
                }),
                reason_code: 'DEFECTIVE',
                reason_text: 'Damaged pack',
                price_tax_mode: 'EXCLUSIVE',
                cash_rounding_unit: 100,
                receipt_locale: 'id-ID',
                net_total: cnCalc1.netTotal,
                service_total: cnCalc1.scTotal,
                tax_total: cnCalc1.taxTotal,
                refund_gross: cnCalc1.refundGross,
                rounding: cnCalc1.rounding,
              },
              lines: [
                {
                  id: idGen.newId(),
                  line_no: 1,
                  sale_line_id: saleLineId,
                  qty_returned: '1.0000',
                  qty_returned_base: '1.0000',
                  refund_net: lineCalc1.net,
                  refund_service: lineCalc1.sc,
                  refund_tax: lineCalc1.tax,
                  is_final_return: lineCalc1.isLast,
                  disposition: 'BUANG',
                },
              ],
              refunds: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: env.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: cnCalc1.refundCashApplied!,
                  reference: null,
                },
              ],
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-1' },
    )
    expect(rCn1.results[0]!.outcome).toBe('ACK')

    // Cumulative qty > 3 (trying 3 more when 1 already returned) -> ATTENTION RETURN_EXCEEDS_QTY
    const rExceed = await processPush(
      env.syncDevice,
      {
        sent_at_device: '2026-11-20T10:05:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: idGen.newId(),
            type: 'FinalizeCreditNote',
            schema_version: 1,
            device_seq: 4,
            depends_on: [saleId],
            created_at_device: '2026-11-20T10:05:00.000Z',
            payload: {
              credit_note: {
                id: idGen.newId(),
                shift_id: shiftId,
                created_by: env.actor.appUserId,
                approved_by: env.supId,
                created_at_device: '2026-11-20T10:05:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T10:05:00.000Z',
                business_date: '2026-11-20',
                cn_no: formatInvoiceNo({ prefix: 'OUT01-POS01', kind: 'CREDIT_NOTE', period: cnPeriod, seq: 2 }),
                cn_prefix: 'OUT01-POS01',
                cn_period: cnPeriod,
                cn_seq: 2,
                original_sale_id: saleId,
                original_invoice_no: formatInvoiceNo({
                  prefix: 'OUT01-POS01',
                  kind: 'INVOICE',
                  period: cnPeriod,
                  seq: 1,
                }),
                reason_code: 'DEFECTIVE',
                reason_text: null,
                price_tax_mode: 'EXCLUSIVE',
                cash_rounding_unit: 100,
                receipt_locale: 'id-ID',
                net_total: 48_330,
                service_total: 0,
                tax_total: 5_316,
                refund_gross: 53_646,
                rounding: 54,
              },
              lines: [
                {
                  id: idGen.newId(),
                  line_no: 1,
                  sale_line_id: saleLineId,
                  qty_returned: '3.0000',
                  qty_returned_base: '3.0000',
                  refund_net: 48_330,
                  refund_service: 0,
                  refund_tax: 5_316,
                  is_final_return: true,
                  disposition: 'KEMBALI_STOK',
                },
              ],
              refunds: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: env.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: 53_700,
                  reference: null,
                },
              ],
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-exceed' },
    )
    const exceedRes = rExceed.results[0]!
    expect(exceedRes.outcome).toBe('ATTENTION')
    if (exceedRes.outcome === 'ATTENTION') {
      expect(exceedRes.reason_code).toBe('RETURN_EXCEEDS_QTY')
    }

    // PAYMENT_MISMATCH check
    const rMismatch = await processPush(
      env.syncDevice,
      {
        sent_at_device: '2026-11-20T10:06:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: idGen.newId(),
            type: 'FinalizeCreditNote',
            schema_version: 1,
            device_seq: 5,
            depends_on: [saleId],
            created_at_device: '2026-11-20T10:06:00.000Z',
            payload: {
              credit_note: {
                id: idGen.newId(),
                shift_id: shiftId,
                created_by: env.actor.appUserId,
                approved_by: env.supId,
                created_at_device: '2026-11-20T10:06:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T10:06:00.000Z',
                business_date: '2026-11-20',
                cn_no: cnNo1,
                cn_prefix: 'OUT01-POS01',
                cn_period: cnPeriod,
                cn_seq: 1,
                original_sale_id: saleId,
                original_invoice_no: formatInvoiceNo({
                  prefix: 'OUT01-POS01',
                  kind: 'INVOICE',
                  period: cnPeriod,
                  seq: 1,
                }),
                reason_code: 'DEFECTIVE',
                reason_text: null,
                price_tax_mode: 'EXCLUSIVE',
                cash_rounding_unit: 100,
                receipt_locale: 'id-ID',
                net_total: 10_000,
                service_total: 0,
                tax_total: 1_100,
                refund_gross: 11_100,
                rounding: 0,
              },
              lines: [
                {
                  id: idGen.newId(),
                  line_no: 1,
                  sale_line_id: saleLineId,
                  qty_returned: '1.0000',
                  qty_returned_base: '1.0000',
                  refund_net: 10_000,
                  refund_service: 0,
                  refund_tax: 1_100,
                  is_final_return: false,
                  disposition: 'BUANG',
                },
              ],
              refunds: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: env.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: 10_000,
                  reference: null,
                },
              ],
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-pay-mismatch' },
    )
    const mismatchRes = rMismatch.results[0]!
    expect(mismatchRes.outcome).toBe('ATTENTION')
    if (mismatchRes.outcome === 'ATTENTION') {
      expect(mismatchRes.reason_code).toBe('PAYMENT_MISMATCH')
    }

    // Duplicate CN seq (1) + wrong math -> -D1 conflict AND SELISIH_HITUNG flag + SERIES_CONFLICT
    const cnIdConflict = idGen.newId()
    const rConflict = await processPush(
      env.syncDevice,
      {
        sent_at_device: '2026-11-20T10:10:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: cnIdConflict,
            type: 'FinalizeCreditNote',
            schema_version: 1,
            device_seq: 6,
            depends_on: [saleId],
            created_at_device: '2026-11-20T10:10:00.000Z',
            payload: {
              credit_note: {
                id: cnIdConflict,
                shift_id: shiftId,
                created_by: env.actor.appUserId,
                approved_by: env.supId,
                created_at_device: '2026-11-20T10:10:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T10:10:00.000Z',
                business_date: '2026-11-20',
                cn_no: cnNo1,
                cn_prefix: 'OUT01-POS01',
                cn_period: cnPeriod,
                cn_seq: 1,
                original_sale_id: saleId,
                original_invoice_no: formatInvoiceNo({
                  prefix: 'OUT01-POS01',
                  kind: 'INVOICE',
                  period: cnPeriod,
                  seq: 1,
                }),
                reason_code: 'DEFECTIVE',
                reason_text: null,
                price_tax_mode: 'EXCLUSIVE',
                cash_rounding_unit: 100,
                receipt_locale: 'id-ID',
                net_total: 10_000,
                service_total: 0,
                tax_total: 1_100,
                refund_gross: 11_100,
                rounding: 0,
              },
              lines: [
                {
                  id: idGen.newId(),
                  line_no: 1,
                  sale_line_id: saleLineId,
                  qty_returned: '1.0000',
                  qty_returned_base: '1.0000',
                  refund_net: 10_000,
                  refund_service: 0,
                  refund_tax: 1_100,
                  is_final_return: false,
                  disposition: 'KEMBALI_STOK',
                },
              ],
              refunds: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: env.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: 11_100,
                  reference: null,
                },
              ],
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-conflict' },
    )
    expect(rConflict.results[0]!.outcome).toBe('ACK')

    await withTenant(env.tenantId, async (tx) => {
      const cnRows = await tx.execute<{
        id: string
        cn_no: string
        cn_conflict_idx: number
        refund_total: number
      }>(`SELECT id, cn_no, cn_conflict_idx, refund_total FROM credit_note ORDER BY cn_conflict_idx ASC`)
      expect(cnRows.rows).toHaveLength(2)
      expect(cnRows.rows[0]).toMatchObject({
        id: cnId1,
        cn_no: cnNo1,
        cn_conflict_idx: 0,
        refund_total: 17_900,
      })
      expect(cnRows.rows[1]).toMatchObject({
        id: cnIdConflict,
        cn_no: `${cnNo1}-D1`,
        cn_conflict_idx: 1,
        refund_total: 11_100,
      })

      const flagRows = await tx.execute<{ flag_code: string }>(
        `SELECT flag_code FROM data_flag WHERE entity_type = 'CREDIT_NOTE' AND entity_id = '${cnIdConflict}'`,
      )
      const codes = new Set(flagRows.rows.map((r) => r.flag_code))
      expect(codes).toEqual(new Set(['NOMOR_KONFLIK', 'SELISIH_HITUNG']))

      const attRows = await tx.execute<{ reason_code: string }>(
        `SELECT reason_code FROM attention_item WHERE command_id = '${cnIdConflict}'`,
      )
      expect(attRows.rows[0]?.reason_code).toBe('SERIES_CONFLICT')
    })
  })

  it('rejects returns on VOID invoices and outside V-23 3-month return window', async () => {
    const env = await setupCnEnv(uniqueSlug('cn-rules'))
    const shiftId = idGen.newId()
    const augSaleId = idGen.newId()
    const augLineId = idGen.newId()
    const voidSaleId = idGen.newId()
    const voidLineId = idGen.newId()

    await processPush(
      env.syncDevice,
      {
        sent_at_device: '2026-08-31T08:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: shiftId,
            type: 'OpenShift',
            schema_version: 1,
            device_seq: 1,
            depends_on: [],
            created_at_device: '2026-08-31T08:00:00.000Z',
            payload: {
              shift: {
                id: shiftId,
                created_by: env.actor.appUserId,
                created_at_device: '2026-08-31T08:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-08-31T08:00:00.000Z',
                business_date: '2026-08-31',
                opening_cash: 100_000,
              },
            },
          },
          makeSaleEnvelope(env, {
            saleId: augSaleId,
            saleLineId: augLineId,
            shiftId,
            deviceSeq: 2,
            businessDate: '2026-08-31',
            occurredAt: '2026-08-31T09:00:00.000Z',
            invoiceSeq: 1,
            qty: '2',
            unitPrice: 10_000,
          }),
          makeSaleEnvelope(env, {
            saleId: voidSaleId,
            saleLineId: voidLineId,
            shiftId,
            deviceSeq: 3,
            businessDate: '2026-08-31',
            occurredAt: '2026-08-31T09:05:00.000Z',
            invoiceSeq: 2,
            qty: '1',
            unitPrice: 10_000,
          }),
          {
            id: idGen.newId(),
            type: 'VoidSale',
            schema_version: 1,
            device_seq: 4,
            depends_on: [voidSaleId],
            created_at_device: '2026-08-31T09:10:00.000Z',
            payload: {
              sale_id: voidSaleId,
              voided_at: '2026-08-31T09:10:00.000Z',
              voided_by: env.actor.appUserId,
              void_approved_by: env.supId,
              reason_code: 'MISTAKE',
              reason_text: 'Voided immediately',
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-rules-setup' },
    )

    // Return on VOID sale -> ATTENTION VALIDATION_FAILED (ORIGINAL_VOID)
    const rVoidReturn = await processPush(
      env.syncDevice,
      {
        sent_at_device: '2026-09-01T10:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: idGen.newId(),
            type: 'FinalizeCreditNote',
            schema_version: 1,
            device_seq: 5,
            depends_on: [voidSaleId],
            created_at_device: '2026-09-01T10:00:00.000Z',
            payload: {
              credit_note: {
                id: idGen.newId(),
                shift_id: shiftId,
                created_by: env.actor.appUserId,
                approved_by: env.supId,
                created_at_device: '2026-09-01T10:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-09-01T10:00:00.000Z',
                business_date: '2026-09-01',
                cn_no: formatInvoiceNo({
                  prefix: 'OUT01-POS01',
                  kind: 'CREDIT_NOTE',
                  period: '0926',
                  seq: 1,
                }),
                cn_prefix: 'OUT01-POS01',
                cn_period: '0926',
                cn_seq: 1,
                original_sale_id: voidSaleId,
                original_invoice_no: formatInvoiceNo({
                  prefix: 'OUT01-POS01',
                  kind: 'INVOICE',
                  period: '0826',
                  seq: 2,
                }),
                reason_code: 'DEFECTIVE',
                reason_text: null,
                price_tax_mode: 'EXCLUSIVE',
                cash_rounding_unit: 100,
                receipt_locale: 'id-ID',
                net_total: 9009,
                service_total: 0,
                tax_total: 991,
                refund_gross: 10_000,
                rounding: 0,
              },
              lines: [
                {
                  id: idGen.newId(),
                  line_no: 1,
                  sale_line_id: voidLineId,
                  qty_returned: '1.0000',
                  qty_returned_base: '1.0000',
                  refund_net: 9009,
                  refund_service: 0,
                  refund_tax: 991,
                  is_final_return: true,
                  disposition: 'KEMBALI_STOK',
                },
              ],
              refunds: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: env.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: 10_000,
                  reference: null,
                },
              ],
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-void-orig' },
    )
    const voidReturnRes = rVoidReturn.results[0]!
    expect(voidReturnRes.outcome).toBe('ATTENTION')
    if (voidReturnRes.outcome === 'ATTENTION') {
      expect(voidReturnRes.reason_code).toBe('VALIDATION_FAILED')
    }

    // V-23: 2026-08-31 -> 2026-12-01 exceeds 3 calendar months -> ATTENTION VALIDATION_FAILED
    const rTooLate = await processPush(
      env.syncDevice,
      {
        sent_at_device: '2026-12-01T10:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: idGen.newId(),
            type: 'FinalizeCreditNote',
            schema_version: 1,
            device_seq: 6,
            depends_on: [augSaleId],
            created_at_device: '2026-12-01T10:00:00.000Z',
            payload: {
              credit_note: {
                id: idGen.newId(),
                shift_id: shiftId,
                created_by: env.actor.appUserId,
                approved_by: env.supId,
                created_at_device: '2026-12-01T10:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-12-01T10:00:00.000Z',
                business_date: '2026-12-01',
                cn_no: formatInvoiceNo({
                  prefix: 'OUT01-POS01',
                  kind: 'CREDIT_NOTE',
                  period: '1226',
                  seq: 1,
                }),
                cn_prefix: 'OUT01-POS01',
                cn_period: '1226',
                cn_seq: 1,
                original_sale_id: augSaleId,
                original_invoice_no: formatInvoiceNo({
                  prefix: 'OUT01-POS01',
                  kind: 'INVOICE',
                  period: '0826',
                  seq: 1,
                }),
                reason_code: 'DEFECTIVE',
                reason_text: null,
                price_tax_mode: 'EXCLUSIVE',
                cash_rounding_unit: 100,
                receipt_locale: 'id-ID',
                net_total: 9009,
                service_total: 0,
                tax_total: 991,
                refund_gross: 10_000,
                rounding: 0,
              },
              lines: [
                {
                  id: idGen.newId(),
                  line_no: 1,
                  sale_line_id: augLineId,
                  qty_returned: '1.0000',
                  qty_returned_base: '1.0000',
                  refund_net: 9009,
                  refund_service: 0,
                  refund_tax: 991,
                  is_final_return: false,
                  disposition: 'KEMBALI_STOK',
                },
              ],
              refunds: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: env.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: 10_000,
                  reference: null,
                },
              ],
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-late' },
    )
    const tooLateRes = rTooLate.results[0]!
    expect(tooLateRes.outcome).toBe('ATTENTION')
    if (tooLateRes.outcome === 'ATTENTION') {
      expect(tooLateRes.reason_code).toBe('VALIDATION_FAILED')
    }

    // V-23 boundary: 2026-08-31 -> 2026-11-30 is inclusive boundary -> ACK
    const rBoundaryOk = await processPush(
      env.syncDevice,
      {
        sent_at_device: '2026-11-30T10:00:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: idGen.newId(),
            type: 'FinalizeCreditNote',
            schema_version: 1,
            device_seq: 7,
            depends_on: [augSaleId],
            created_at_device: '2026-11-30T10:00:00.000Z',
            payload: {
              credit_note: {
                id: idGen.newId(),
                shift_id: shiftId,
                created_by: env.actor.appUserId,
                approved_by: env.supId,
                created_at_device: '2026-11-30T10:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-30T10:00:00.000Z',
                business_date: '2026-11-30',
                cn_no: formatInvoiceNo({
                  prefix: 'OUT01-POS01',
                  kind: 'CREDIT_NOTE',
                  period: '1126',
                  seq: 1,
                }),
                cn_prefix: 'OUT01-POS01',
                cn_period: '1126',
                cn_seq: 1,
                original_sale_id: augSaleId,
                original_invoice_no: formatInvoiceNo({
                  prefix: 'OUT01-POS01',
                  kind: 'INVOICE',
                  period: '0826',
                  seq: 1,
                }),
                reason_code: 'DEFECTIVE',
                reason_text: null,
                price_tax_mode: 'EXCLUSIVE',
                cash_rounding_unit: 100,
                receipt_locale: 'id-ID',
                net_total: 9009,
                service_total: 0,
                tax_total: 991,
                refund_gross: 10_000,
                rounding: 0,
              },
              lines: [
                {
                  id: idGen.newId(),
                  line_no: 1,
                  sale_line_id: augLineId,
                  qty_returned: '1.0000',
                  qty_returned_base: '1.0000',
                  refund_net: 9009,
                  refund_service: 0,
                  refund_tax: 991,
                  is_final_return: false,
                  disposition: 'KEMBALI_STOK',
                },
              ],
              refunds: [
                {
                  id: idGen.newId(),
                  seq: 1,
                  method_id: env.cashMethodId,
                  method_code: 'CASH',
                  method_name: 'Tunai',
                  method_kind: 'CASH',
                  amount_applied: 10_000,
                  reference: null,
                },
              ],
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-ok-nov30' },
    )
    expect(rBoundaryOk.results[0]!.outcome).toBe('ACK')
  })

  it('serializes parallel partial returns on the same sale_line via FOR UPDATE so cumulative qty cannot oversell', async () => {
    const env = await setupCnEnv(uniqueSlug('cn-par'))
    const shiftId = idGen.newId()
    const saleId = idGen.newId()
    const saleLineId = idGen.newId()

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
                opening_cash: 100_000,
              },
            },
          },
          makeSaleEnvelope(env, {
            saleId,
            saleLineId,
            shiftId,
            deviceSeq: 2,
            businessDate: '2026-11-20',
            occurredAt: '2026-11-20T09:00:00.000Z',
            invoiceSeq: 1,
            qty: '3',
            unitPrice: 10_000,
          }),
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-par-setup' },
    )

    const buildReturn = (seq: number): PushCommandEnvelope => ({
      id: idGen.newId(),
      type: 'FinalizeCreditNote',
      schema_version: 1,
      device_seq: 10 + seq,
      depends_on: [saleId],
      created_at_device: '2026-11-20T10:00:00.000Z',
      payload: {
        credit_note: {
          id: idGen.newId(),
          shift_id: shiftId,
          created_by: env.actor.appUserId,
          approved_by: env.supId,
          created_at_device: '2026-11-20T10:00:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-20T10:00:00.000Z',
          business_date: '2026-11-20',
          cn_no: formatInvoiceNo({
            prefix: 'OUT01-POS01',
            kind: 'CREDIT_NOTE',
            period: '1126',
            seq,
          }),
          cn_prefix: 'OUT01-POS01',
          cn_period: '1126',
          cn_seq: seq,
          original_sale_id: saleId,
          original_invoice_no: formatInvoiceNo({
            prefix: 'OUT01-POS01',
            kind: 'INVOICE',
            period: '1126',
            seq: 1,
          }),
          reason_code: 'DEFECTIVE',
          reason_text: null,
          price_tax_mode: 'EXCLUSIVE',
          cash_rounding_unit: 100,
          receipt_locale: 'id-ID',
          net_total: 18_018,
          service_total: 0,
          tax_total: 1_982,
          refund_gross: 20_000,
          rounding: 0,
        },
        lines: [
          {
            id: idGen.newId(),
            line_no: 1,
            sale_line_id: saleLineId,
            qty_returned: '2.0000',
            qty_returned_base: '2.0000',
            refund_net: 18_018,
            refund_service: 0,
            refund_tax: 1_982,
            is_final_return: false,
            disposition: 'KEMBALI_STOK',
          },
        ],
        refunds: [
          {
            id: idGen.newId(),
            seq: 1,
            method_id: env.cashMethodId,
            method_code: 'CASH',
            method_name: 'Tunai',
            method_kind: 'CASH',
            amount_applied: 20_000,
            reference: null,
          },
        ],
      },
    })

    const [p1, p2] = await Promise.all([
      processPush(
        env.syncDevice,
        { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [buildReturn(1)] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-par-1' },
      ),
      processPush(
        env.syncDevice,
        { sent_at_device: '2026-11-20T10:00:01.000Z', clock_offset_ms: 0, commands: [buildReturn(2)] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'cn-par-2' },
      ),
    ])

    const outcomes = [p1.results[0]!.outcome, p2.results[0]!.outcome].sort()
    expect(outcomes).toEqual(['ACK', 'ATTENTION'])
    const rejected = p1.results[0]!.outcome === 'ATTENTION' ? p1.results[0]! : p2.results[0]!
    if (rejected.outcome === 'ATTENTION') {
      expect(rejected.reason_code).toBe('RETURN_EXCEEDS_QTY')
    }
  })
})
