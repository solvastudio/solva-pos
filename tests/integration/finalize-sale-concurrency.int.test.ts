import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { type PushCommandEnvelope } from '~/lib/contracts'
import { createIdGenerator, formatInvoiceNo } from '~/lib/kernel'
import { calcAndSettle } from '~/lib/sales-calc'
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

const testOp = { platformUserId: idGen.newId(), email: 'op-conc@example.test' }

async function setupConcurrencyEnv(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Conc ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Conc', isPkp: false })
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
  const d1 = await enrollDevice({ slug, code: p1.code, device_name: 'Dev1' }, '10.6.0.1', { minDelayMs: 0 })
  const p2 = await createPairingCode(actor, reg2.id)
  const d2 = await enrollDevice({ slug, code: p2.code, device_name: 'Dev2' }, '10.6.0.2', { minDelayMs: 0 })

  const seeded = await masterTx(created.tenantId, async (c, v) => {
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
    const makeItem = async (code: string) => {
      const pId = (
        await c.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id)
           VALUES ($1, $2, $3, $4, $4, $5) RETURNING id`,
          [created.tenantId, v, catId, code, pcsId],
        )
      ).rows[0]!.id
      const sId = (
        await c.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [created.tenantId, v, pId, `${code}-1`],
        )
      ).rows[0]!.id
      return { pId, sId, code: `${code}-1`, name: code }
    }
    const kopi = await makeItem('KOPI')
    const gula = await makeItem('GULA')
    const susu = await makeItem('SUSU')
    const existingCash = await c.query<{ id: string }>(
      `SELECT id FROM payment_method WHERE tenant_id = $1 AND code = 'CASH' AND deleted_at IS NULL LIMIT 1`,
      [created.tenantId],
    )
    const cashId =
      existingCash.rows[0]?.id ??
      (
        await c.query<{ id: string }>(
          `INSERT INTO payment_method (tenant_id, version, code, name, kind)
           VALUES ($1, $2, 'CASH', 'Tunai', 'CASH') RETURNING id`,
          [created.tenantId, v],
        )
      ).rows[0]!.id
    const shift1 = idGen.newId()
    const shift2 = idGen.newId()
    for (const [sid, rid, did] of [
      [shift1, reg1.id, d1.device_id],
      [shift2, reg2.id, d2.device_id],
    ] as const) {
      const cmdId = idGen.newId()
      await c.query(
        `INSERT INTO idempotency_command (command_id, tenant_id, device_id, register_id, outlet_id, command_type, schema_version, device_seq, payload_hash, status, result)
         VALUES ($1, $2, $3, $4, $5, 'OpenShift', 1, 0, repeat('a', 64), 'ACKED', '{}'::jsonb)`,
        [cmdId, created.tenantId, did, rid, outlet.id],
      )
      await c.query(
        `INSERT INTO cash_cashier (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, opening_cash)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, 100000)`,
        [sid, created.tenantId, outlet.id, rid, did, actor.appUserId, cmdId],
      )
    }
    return { pcsId, kopi, gula, susu, cashId, shift1, shift2, version: v }
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

function buildSale(
  env: Awaited<ReturnType<typeof setupConcurrencyEnv>>,
  reg: 1 | 2,
  deviceSeq: number,
  invoiceSeq: number,
): PushCommandEnvelope {
  const v04 = SALES_CALC_VECTORS.find((v) => v.id === 'V-04')!
  const { calc, settlement } = calcAndSettle(v04.input, v04.settlement!.payments, 100)
  const prefix = reg === 1 ? 'OUT01-POS01' : 'OUT01-POS02'
  const shiftId = reg === 1 ? env.shift1 : env.shift2
  const saleId = idGen.newId()
  const skuMap: Record<string, { pId: string; sId: string; code: string; name: string }> = {
    'sku-kopi': env.kopi,
    'sku-gula': env.gula,
    'sku-susu': env.susu,
  }

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
        shift_id: shiftId,
        created_by: env.actor.appUserId,
        created_at_device: '2026-11-20T10:00:00.000Z',
        clock_offset_ms: 0,
        occurred_at: '2026-11-20T10:00:00.000Z',
        business_date: '2026-11-20',
        invoice_no: formatInvoiceNo({ prefix, kind: 'INVOICE', period: '1126', seq: invoiceSeq }),
        invoice_prefix: prefix,
        invoice_period: '1126',
        invoice_seq: invoiceSeq,
        legal_entity_id: env.le.id,
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
        gross_total: calc.grossTotal,
        line_discount_total: calc.lineDiscountTotal,
        bill_discount_type: null,
        bill_discount_pct: null,
        bill_discount_input: null,
        bill_discount_total: 0,
        discount_approved_by: null,
        net_subtotal: calc.netSubtotal,
        service_charge: 0,
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
      lines: v04.input.lines.map((cl, idx) => {
        const lc = calc.lines[idx]!
        const sk = skuMap[cl.skuId]!
        return {
          id: idGen.newId(),
          line_no: cl.lineNo,
          line_kind: 'ITEM',
          product_id: sk.pId,
          sku_id: sk.sId,
          uom_id: env.pcsId,
          sku_code: sk.code,
          item_name: sk.name,
          uom_code: 'PCS',
          qty: cl.qty,
          conversion_factor: '1.0000',
          qty_base: cl.qty,
          unit_price: cl.unitPrice,
          price_source: 'OUTLET',
          is_open_price: false,
          taxable: cl.taxable,
          discount_type: cl.discount ? cl.discount.kind : null,
          discount_pct: cl.discount?.kind === 'PERCENT' ? cl.discount.percent : null,
          discount_input: null,
          discount_approved_by: null,
          line_gross: lc.lineGross,
          line_discount: lc.lineDiscount,
          line_net: lc.lineNet,
          bill_discount_alloc: lc.billDiscountAlloc,
          service_alloc: lc.serviceAlloc,
          tax_alloc: lc.taxAlloc,
          note: null,
          source_bill_item_id: null,
        }
      }),
      payments: [
        {
          id: idGen.newId(),
          seq: 1,
          method_id: env.cashId,
          method_code: 'CASH',
          method_name: 'Tunai',
          method_kind: 'CASH',
          amount_applied: settlement.totalDue,
          cash_tendered: 150000,
          change_given: settlement.changeTotal,
          reference: null,
          is_rounding_settler: true,
        },
      ],
    },
  }
}

describe('FinalizeSale concurrency, FIFO sorting, and replay convergence', () => {
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

  it('processes parallel sales across two registers without deadlock and sorts reversed batches FIFO', async () => {
    const env = await setupConcurrencyEnv(uniqueSlug('fs-conc'))

    // 1. Two registers pushing 10 sales each concurrently via Promise.all
    const parallelBatches = [
      ...Array.from({ length: 10 }, (_, idx) =>
        processPush(
          env.dev1,
          {
            sent_at_device: '2026-11-20T10:00:00.000Z',
            clock_offset_ms: 0,
            commands: [buildSale(env, 1, idx + 1, idx + 1)],
          },
          { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `r1-p-${idx}` },
        ),
      ),
      ...Array.from({ length: 10 }, (_, idx) =>
        processPush(
          env.dev2,
          {
            sent_at_device: '2026-11-20T10:00:00.000Z',
            clock_offset_ms: 0,
            commands: [buildSale(env, 2, idx + 1, idx + 1)],
          },
          { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `r2-p-${idx}` },
        ),
      ),
    ]

    const responses = await Promise.all(parallelBatches)
    for (const r of responses) {
      expect(r.results[0]!.outcome).toBe('ACK')
    }

    // 2. Single register sending 20 commands in reverse device_seq order -> FIFO processed cleanly
    const reversedCmds = Array.from({ length: 20 }, (_, i) => {
      const seq = 30 - i
      return buildSale(env, 1, seq, seq)
    })
    const batchRes = await processPush(
      env.dev1,
      { sent_at_device: '2026-11-20T10:05:00.000Z', clock_offset_ms: 0, commands: reversedCmds },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'rev-20' },
    )
    expect(batchRes.results).toHaveLength(20)
    expect(batchRes.results.every((r) => r.outcome === 'ACK')).toBe(true)

    // Verify FIFO order matches ascending sequence (11..30) and zero gaps on reg1
    expect(
      batchRes.results.map((r) => {
        if (r.outcome !== 'ACK') throw new Error('expected ACK')
        return Number(String(r.result.invoice_no).slice(-6))
      }),
    ).toEqual(Array.from({ length: 20 }, (_, i) => 11 + i))

    await withTenant(env.tenantId, async (tx) => {
      const s1 = await tx.execute(
        `SELECT max_seq_received, received_count FROM invoice_series WHERE register_id = '${env.reg1.id}' AND period = '1126'`,
      )
      expect(Number(s1.rows[0]!.max_seq_received)).toBe(30)
      expect(Number(s1.rows[0]!.received_count)).toBe(30)

      const s2 = await tx.execute(
        `SELECT max_seq_received, received_count FROM invoice_series WHERE register_id = '${env.reg2.id}' AND period = '1126'`,
      )
      expect(Number(s2.rows[0]!.max_seq_received)).toBe(10)
      expect(Number(s2.rows[0]!.received_count)).toBe(10)
    })

    // 3. Replay & duplicate convergence under concurrent duplicate push
    const dupCmd = buildSale(env, 1, 31, 31)
    const first = await processPush(
      env.dev1,
      { sent_at_device: '2026-11-20T10:06:00.000Z', clock_offset_ms: 0, commands: [dupCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'dup-first' },
    )
    const dupReplays = await Promise.all(
      [1, 2, 3].map((k) =>
        processPush(
          env.dev1,
          { sent_at_device: '2026-11-20T10:06:01.000Z', clock_offset_ms: 0, commands: [dupCmd] },
          { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `dup-r-${k}` },
        ),
      ),
    )
    for (const dr of dupReplays) {
      expect(dr.results[0]).toEqual(first.results[0])
    }
    await withTenant(env.tenantId, async (tx) => {
      const cnt = await tx.execute(`SELECT count(*)::int AS c FROM sale WHERE register_id = '${env.reg1.id}'`)
      expect(Number(cnt.rows[0]!.c)).toBe(31)
    })
  })
})
