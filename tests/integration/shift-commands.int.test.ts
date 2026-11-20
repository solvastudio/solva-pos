import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { type PushCommandEnvelope } from '~/lib/contracts'
import { createIdGenerator, formatInvoiceNo, invoicePeriod, parseQty, toMoney } from '~/lib/kernel'
import { calcSale } from '~/lib/sales-calc'
import { verifyAuditChain } from '~/modules/audit/public'
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
import { forceCloseShift } from '~/modules/shift/public'
import { processPush, type SyncDeviceIdentity } from '~/modules/sync/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools, withTenant } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { SALES_CALC_VECTORS } from '../../src/lib/sales-calc/sales-calc.vectors'
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

const testOp = { platformUserId: idGen.newId(), email: 'op-shift@example.test' }

async function setupShiftEnv(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Shift ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Shift', isPkp: false })
  const outlet = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })
  const reg1 = await createRegister(actor, {
    outletId: outlet.id,
    code: 'POS01',
    name: 'POS 1',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const reg2 = await createRegister(actor, {
    outletId: outlet.id,
    code: 'POS02',
    name: 'POS 2',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS02',
  })
  const p1 = await createPairingCode(actor, reg1.id)
  const d1 = await enrollDevice({ slug, code: p1.code, device_name: 'Dev1' }, '10.7.0.1', { minDelayMs: 0 })
  const p2 = await createPairingCode(actor, reg2.id)
  const d2 = await enrollDevice({ slug, code: p2.code, device_name: 'Dev2' }, '10.7.0.2', { minDelayMs: 0 })

  const seeded = await masterTx(created.tenantId, async (c, v) => {
    const supId = (
      await c.query<{ id: string }>(
        `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Supervisor Shift') RETURNING id`,
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
        `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id)
         VALUES ($1, $2, $3, 'ITEM1', 'Item 1', $4) RETURNING id`,
        [created.tenantId, v, catId, pcsId],
      )
    ).rows[0]!.id
    const skuId = (
      await c.query<{ id: string }>(
        `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
         VALUES ($1, $2, $3, 'ITEM1-1', true) RETURNING id`,
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
    const qrisMethodId = (
      await c.query<{ id: string }>(
        `INSERT INTO payment_method (tenant_id, version, code, name, kind) VALUES ($1, $2, 'QRIS', 'QRIS', 'NON_CASH') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id

    return { supId, pcsId, prodId, skuId, cashMethodId, qrisMethodId, version: v }
  })

  const dev1: SyncDeviceIdentity = {
    tenantId: created.tenantId,
    deviceId: d1.device_id,
    registerId: reg1.id,
    outletId: outlet.id,
    registerType: 'CASHIER',
  }
  const dev2: SyncDeviceIdentity = {
    tenantId: created.tenantId,
    deviceId: d2.device_id,
    registerId: reg2.id,
    outletId: outlet.id,
    registerType: 'CASHIER',
  }

  return { tenantId: created.tenantId, actor, le, outlet, reg1, reg2, dev1, dev2, ...seeded }
}

function makeOpenShiftCmd(
  env: Awaited<ReturnType<typeof setupShiftEnv>>,
  shiftId: string,
  openingCash: number,
  deviceSeq: number,
): PushCommandEnvelope {
  return {
    id: shiftId,
    type: 'OpenShift',
    schema_version: 1,
    device_seq: deviceSeq,
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
        opening_cash: openingCash,
      },
    },
  }
}

function makeSaleForAmount(
  env: Awaited<ReturnType<typeof setupShiftEnv>>,
  opts: {
    shiftId: string
    deviceSeq: number
    invoiceSeq: number
    cashAmount: number
    qrisAmount?: number
    prefix?: string
    dependsOn?: string[]
  },
): { cmd: PushCommandEnvelope; firstLineId: string } {
  const total = opts.cashAmount + (opts.qrisAmount ?? 0)
  const calc = calcSale({
    lines: [
      {
        lineNo: 1,
        skuId: env.skuId,
        uomId: env.pcsId,
        qty: parseQty('1'),
        unitPrice: toMoney(total),
        taxable: false,
      },
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
  const saleId = idGen.newId()
  const lineId = idGen.newId()
  const prefix = opts.prefix ?? 'OUT01-POS01'
  const period = invoicePeriod('2026-11-20')

  const payments: Array<Record<string, unknown>> = []
  if ((opts.qrisAmount ?? 0) > 0) {
    payments.push({
      id: idGen.newId(),
      seq: 1,
      method_id: env.qrisMethodId,
      method_code: 'QRIS',
      method_name: 'QRIS',
      method_kind: 'NON_CASH',
      amount_applied: opts.qrisAmount!,
      cash_tendered: null,
      change_given: null,
      reference: 'QR-1',
      is_rounding_settler: false,
    })
  }
  if (opts.cashAmount > 0) {
    payments.push({
      id: idGen.newId(),
      seq: payments.length + 1,
      method_id: env.cashMethodId,
      method_code: 'CASH',
      method_name: 'Tunai',
      method_kind: 'CASH',
      amount_applied: opts.cashAmount,
      cash_tendered: opts.cashAmount,
      change_given: 0,
      reference: null,
      is_rounding_settler: false,
    })
  }

  return {
    firstLineId: lineId,
    cmd: {
      id: saleId,
      type: 'FinalizeSale',
      schema_version: 1,
      device_seq: opts.deviceSeq,
      depends_on: opts.dependsOn ?? [],
      created_at_device: '2026-11-20T10:00:00.000Z',
      payload: {
        sale: {
          id: saleId,
          shift_id: opts.shiftId,
          created_by: env.actor.appUserId,
          created_at_device: '2026-11-20T10:00:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-20T10:00:00.000Z',
          business_date: '2026-11-20',
          invoice_no: formatInvoiceNo({ prefix, kind: 'INVOICE', period, seq: opts.invoiceSeq }),
          invoice_prefix: prefix,
          invoice_period: period,
          invoice_seq: opts.invoiceSeq,
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
            id: lineId,
            line_no: 1,
            line_kind: 'ITEM',
            product_id: env.prodId,
            sku_id: env.skuId,
            uom_id: env.pcsId,
            sku_code: 'ITEM1-1',
            item_name: 'Item 1',
            uom_code: 'PCS',
            qty: '1.0000',
            conversion_factor: '1.0000',
            qty_base: '1.0000',
            unit_price: total,
            price_source: 'OUTLET',
            is_open_price: false,
            taxable: false,
            discount_type: null,
            discount_pct: null,
            discount_input: null,
            discount_approved_by: null,
            line_gross: total,
            line_discount: 0,
            line_net: total,
            bill_discount_alloc: 0,
            service_alloc: 0,
            tax_alloc: 0,
            note: null,
            source_bill_item_id: null,
          },
        ],
        payments,
      },
    },
  }
}

describe('Shift commands integration (OpenShift, RecordCashMovement, CloseShift V-21, forceClose)', () => {
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

  it('computes V-21 expected_cash 1,782,100 / variance -2,100, handles INCOMPLETE->COMPLETE, late arrivals, write-once count, and HELD dep', async () => {
    const env = await setupShiftEnv(uniqueSlug('sh-v21'))
    const shift1Id = idGen.newId()
    const shift2Id = idGen.newId()
    expect(SALES_CALC_VECTORS.length).toBeGreaterThan(0)

    // Parallel OPEN shifts across 2 registers in same outlet succeed
    const rOpen = await processPush(
      env.dev1,
      {
        sent_at_device: '2026-11-20T08:00:00.000Z',
        clock_offset_ms: 0,
        commands: [makeOpenShiftCmd(env, shift1Id, 500_000, 1)],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'os-1' },
    )
    expect(rOpen.results[0]!.outcome).toBe('ACK')

    const rOpen2 = await processPush(
      env.dev2,
      {
        sent_at_device: '2026-11-20T08:00:00.000Z',
        clock_offset_ms: 0,
        commands: [makeOpenShiftCmd(env, shift2Id, 100_000, 1)],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'os-2' },
    )
    expect(rOpen2.results[0]!.outcome).toBe('ACK')

    // Duplicate OpenShift on reg1 -> ATTENTION SHIFT_ALREADY_OPEN
    const rOpenDup = await processPush(
      env.dev1,
      {
        sent_at_device: '2026-11-20T08:01:00.000Z',
        clock_offset_ms: 0,
        commands: [makeOpenShiftCmd(env, idGen.newId(), 200_000, 2)],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'os-dup' },
    )
    expect(rOpenDup.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'VALIDATION_FAILED',
    })

    // V-21: Cash sales totaling 1,250,000 (plus 400,000 QRIS excluded from cash)
    const sale1 = makeSaleForAmount(env, {
      shiftId: shift1Id,
      deviceSeq: 3,
      invoiceSeq: 1,
      cashAmount: 750_000,
      qrisAmount: 400_000,
    })
    const sale2 = makeSaleForAmount(env, {
      shiftId: shift1Id,
      deviceSeq: 4,
      invoiceSeq: 2,
      cashAmount: 500_000,
    })
    const movIn: PushCommandEnvelope = {
      id: idGen.newId(),
      type: 'RecordCashMovement',
      schema_version: 1,
      device_seq: 5,
      depends_on: [shift1Id],
      created_at_device: '2026-11-20T12:00:00.000Z',
      payload: {
        movement: {
          id: idGen.newId(),
          shift_id: shift1Id,
          created_by: env.actor.appUserId,
          created_at_device: '2026-11-20T12:00:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-20T12:00:00.000Z',
          business_date: '2026-11-20',
          direction: 'IN',
          amount: 200_000,
          reason_code: 'FLOAT_TOPUP',
          reason_text: 'Change coins top-up',
        },
      },
    }
    const movOut: PushCommandEnvelope = {
      id: idGen.newId(),
      type: 'RecordCashMovement',
      schema_version: 1,
      device_seq: 6,
      depends_on: [shift1Id],
      created_at_device: '2026-11-20T13:00:00.000Z',
      payload: {
        movement: {
          id: idGen.newId(),
          shift_id: shift1Id,
          created_by: env.actor.appUserId,
          created_at_device: '2026-11-20T13:00:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-20T13:00:00.000Z',
          business_date: '2026-11-20',
          direction: 'OUT',
          amount: 150_000,
          reason_code: 'PETTY_CASH',
          reason_text: 'Courier payment',
        },
      },
    }
    const cnRefund: PushCommandEnvelope = {
      id: idGen.newId(),
      type: 'FinalizeCreditNote',
      schema_version: 1,
      device_seq: 7,
      depends_on: [sale2.cmd.id],
      created_at_device: '2026-11-20T14:00:00.000Z',
      payload: {
        credit_note: {
          id: idGen.newId(),
          shift_id: shift1Id,
          created_by: env.actor.appUserId,
          approved_by: env.supId,
          created_at_device: '2026-11-20T14:00:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-20T14:00:00.000Z',
          business_date: '2026-11-20',
          cn_no: 'OUT01-POS01-NK-1126-000001',
          cn_prefix: 'OUT01-POS01',
          cn_period: '1126',
          cn_seq: 1,
          original_sale_id: sale2.cmd.id,
          original_invoice_no: 'OUT01-POS01-1126-000002',
          reason_code: 'RETURN',
          reason_text: 'Partial return',
          price_tax_mode: 'EXCLUSIVE',
          cash_rounding_unit: 0,
          receipt_locale: 'id-ID',
          net_total: 17_900,
          service_total: 0,
          tax_total: 0,
          refund_gross: 17_900,
          rounding: 0,
        },
        lines: [
          {
            id: idGen.newId(),
            line_no: 1,
            sale_line_id: sale2.firstLineId,
            qty_returned: '0.1000',
            qty_returned_base: '0.1000',
            refund_net: 17_900,
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
            method_id: env.cashMethodId,
            method_code: 'CASH',
            method_name: 'Tunai',
            method_kind: 'CASH',
            amount_applied: 17_900,
            reference: null,
          },
        ],
      },
    }

    const midRes = await processPush(
      env.dev1,
      {
        sent_at_device: '2026-11-20T14:05:00.000Z',
        clock_offset_ms: 0,
        commands: [sale1.cmd, sale2.cmd, movIn, movOut, cnRefund],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'v21-mid' },
    )
    expect(midRes.results.every((r) => r.outcome === 'ACK')).toBe(true)

    // Simulate pending_count > 0 so CloseShift initially produces INCOMPLETE
    await withTenant(env.tenantId, async (tx) => {
      await tx.execute(
        `UPDATE device_sync_status SET pending_count = 1 WHERE device_id = '${env.dev1.deviceId}'`,
      )
    })

    const closeCmd: PushCommandEnvelope = {
      id: idGen.newId(),
      type: 'CloseShift',
      schema_version: 1,
      device_seq: 8,
      depends_on: [shift1Id],
      created_at_device: '2026-11-20T21:00:00.000Z',
      payload: {
        shift_id: shift1Id,
        counted_cash: 1_780_000,
        count_submitted_at: '2026-11-20T21:00:00.000Z',
        closed_at: '2026-11-20T21:01:00.000Z',
        closed_at_device: '2026-11-20T21:01:00.000Z',
        expected_cash_device: 1_782_100,
        variance_device: -2_100,
        close_note: 'V-21 coin shortage',
      },
    }
    const closeRes = await processPush(
      env.dev1,
      { sent_at_device: '2026-11-20T21:02:00.000Z', clock_offset_ms: 0, commands: [closeCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'v21-close' },
    )
    expect(closeRes.results[0]!.outcome).toBe('ACK')

    await withTenant(env.tenantId, async (tx) => {
      const sh = await tx.execute(`SELECT * FROM cash_cashier WHERE id = '${shift1Id}'`)
      const r = sh.rows[0] as Record<string, unknown>
      expect(r.status).toBe('CLOSED')
      expect(Number(r.expected_cash)).toBe(1_782_100)
      expect(Number(r.variance)).toBe(-2_100)
      expect(r.recap_status).toBe('INCOMPLETE')
    })

    // Conflicting recount after lock -> ATTENTION VALIDATION_FAILED
    const badRecount: PushCommandEnvelope = {
      ...closeCmd,
      id: idGen.newId(),
      device_seq: 9,
      payload: {
        ...(closeCmd.payload as Record<string, unknown>),
        counted_cash: 1_790_000,
      },
    }
    const recountRes = await processPush(
      env.dev1,
      { sent_at_device: '2026-11-20T21:03:00.000Z', clock_offset_ms: 0, commands: [badRecount] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'v21-recount' },
    )
    expect(recountRes.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'VALIDATION_FAILED',
    })

    // Clear pending_count and send late CashMovement (+10,000 IN) -> recap becomes COMPLETE and 1,792,100!
    await withTenant(env.tenantId, async (tx) => {
      await tx.execute(
        `UPDATE device_sync_status SET pending_count = 0 WHERE device_id = '${env.dev1.deviceId}'`,
      )
    })
    const lateIn: PushCommandEnvelope = {
      id: idGen.newId(),
      type: 'RecordCashMovement',
      schema_version: 1,
      device_seq: 10,
      depends_on: [],
      created_at_device: '2026-11-20T20:30:00.000Z',
      payload: {
        movement: {
          id: idGen.newId(),
          shift_id: shift1Id,
          created_by: env.actor.appUserId,
          created_at_device: '2026-11-20T20:30:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-20T20:30:00.000Z',
          business_date: '2026-11-20',
          direction: 'IN',
          amount: 10_000,
          reason_code: 'LATE_TOPUP',
          reason_text: 'Delayed offline cash in',
        },
      },
    }
    const lateRes = await processPush(
      env.dev1,
      { sent_at_device: '2026-11-20T21:05:00.000Z', clock_offset_ms: 0, commands: [lateIn] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'v21-late' },
    )
    expect(lateRes.results[0]!.outcome).toBe('ACK')

    await withTenant(env.tenantId, async (tx) => {
      const sh = await tx.execute(`SELECT * FROM cash_cashier WHERE id = '${shift1Id}'`)
      const r = sh.rows[0] as Record<string, unknown>
      expect(Number(r.expected_cash)).toBe(1_792_100)
      expect(r.recap_status).toBe('COMPLETE')
    })

    // HELD dependency on RecordCashMovement -> shift on reg2, depends on unseen parent
    const unseenParentId = idGen.newId()
    const heldMov: PushCommandEnvelope = {
      id: idGen.newId(),
      type: 'RecordCashMovement',
      schema_version: 1,
      device_seq: 2,
      depends_on: [unseenParentId],
      created_at_device: '2026-11-20T21:05:00.000Z',
      payload: {
        movement: {
          id: idGen.newId(),
          shift_id: shift2Id,
          created_by: env.actor.appUserId,
          created_at_device: '2026-11-20T21:05:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-20T21:05:00.000Z',
          business_date: '2026-11-20',
          direction: 'IN',
          amount: 5_000,
          reason_code: 'HELD_TEST',
          reason_text: 'Waiting for parent',
        },
      },
    }
    const heldRes = await processPush(
      env.dev2,
      { sent_at_device: '2026-11-20T21:06:00.000Z', clock_offset_ms: 0, commands: [heldMov] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'held-m' },
    )
    expect(heldRes.results[0]!.outcome).toBe('HELD')

    // forceCloseShift on OPEN shift2 -> FORCE_CLOSED + audit
    await expect(
      forceCloseShift(env.actor, { shiftId: shift2Id, countedCash: 100_000, reasonText: '   ' }),
    ).rejects.toThrow()
    const fcRes = await forceCloseShift(env.actor, {
      shiftId: shift2Id,
      countedCash: 100_000,
      reasonText: 'Cashier forgot to close before leaving',
    })
    expect(fcRes).toEqual({ shiftId: shift2Id, status: 'FORCE_CLOSED' })

    // Closed shift cannot be force-closed again
    await expect(
      forceCloseShift(env.actor, { shiftId: shift2Id, countedCash: 100_000, reasonText: 'Retry' }),
    ).rejects.toThrow()

    await withTenant(env.tenantId, async (tx) => {
      const chain = await verifyAuditChain(tx)
      expect(chain.ok).toBe(true)
    })
  })
})
