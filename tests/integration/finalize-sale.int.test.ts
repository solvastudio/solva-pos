import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { type PushCommandEnvelope } from '~/lib/contracts'
import { createIdGenerator, formatInvoiceNo, invoicePeriod, parseQty, toMoney } from '~/lib/kernel'
import { calcAndSettle, type PaymentInput, type SaleCalcInput } from '~/lib/sales-calc'
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
import { appClient, withClient } from './helpers/db'
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

const testOp = { platformUserId: idGen.newId(), email: 'op-fs@example.test' }

async function setupSaleEnv(slug: string, opts?: { registerType?: 'CASHIER' | 'WAITER' }) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `FS ${slug}`,
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
  const le = await createLegalEntity(actor, {
    name: 'PT Penjualan',
    isPkp: true,
    npwp: '012345678901234',
  })
  const outlet = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })
  const regType = opts?.registerType ?? 'CASHIER'
  const reg = await createRegister(actor, {
    outletId: outlet.id,
    code: regType === 'CASHIER' ? 'POS01' : 'WTR01',
    name: regType === 'CASHIER' ? 'Kasir 1' : 'Waiter 1',
    registerType: regType,
    invoicePrefix: regType === 'CASHIER' ? 'OUT01-POS01' : null,
  })
  const pairing = await createPairingCode(actor, reg.id)
  const enrolled = await enrollDevice(
    { slug, code: pairing.code, device_name: 'POS Tablet' },
    '10.4.0.1',
    { minDelayMs: 0 },
  )
  const syncDevice: SyncDeviceIdentity = {
    tenantId: created.tenantId,
    deviceId: enrolled.device_id,
    registerId: reg.id,
    outletId: outlet.id,
    registerType: regType,
  }

  const seeded = await masterTx(created.tenantId, async (c, v) => {
    const catId = (
      await c.query<{ id: string }>(
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Minuman') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id
    const pcsId = (
      await c.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pieces') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id

    const skuSpecs = [
      { key: 'sku-kopi', code: 'KOPI', price: 18500, open: false },
      { key: 'sku-gula', code: 'GULA', price: 16000, open: false },
      { key: 'sku-susu', code: 'SUSU', price: 17900, open: false },
      { key: 'sku-nasgor', code: 'NASGOR', price: 35000, open: false },
      { key: 'sku-esteh', code: 'ESTEH', price: 8000, open: false },
      { key: 'sku-ayam', code: 'AYAM', price: 44500, open: false },
      { key: 'sku-open', code: 'OPEN', price: 0, open: true },
    ] as const

    const skus: Record<string, { productId: string; skuId: string; code: string; name: string }> = {}
    for (const spec of skuSpecs) {
      const pId = (
        await c.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id, is_open_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [created.tenantId, v, catId, spec.code, spec.code, pcsId, spec.open],
        )
      ).rows[0]!.id
      const sId = (
        await c.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [created.tenantId, v, pId, `${spec.code}-1`],
        )
      ).rows[0]!.id
      await c.query(
        `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base)
         VALUES ($1, $2, $3, $4, 1, true)`,
        [created.tenantId, v, sId, pcsId],
      )
      if (!spec.open) {
        await c.query(
          `INSERT INTO price_entry (tenant_id, version, sku_id, uom_id, outlet_id, price)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [created.tenantId, v, sId, pcsId, outlet.id, spec.price],
        )
      }
      skus[spec.key] = { productId: pId, skuId: sId, code: `${spec.code}-1`, name: spec.code }
    }

    const existingCash = await c.query<{ id: string }>(
      `SELECT id FROM payment_method WHERE tenant_id = $1 AND code = 'CASH' AND deleted_at IS NULL LIMIT 1`,
      [created.tenantId],
    )
    const cashMethodId =
      existingCash.rows[0]?.id ??
      (
        await c.query<{ id: string }>(
          `INSERT INTO payment_method (tenant_id, version, code, name, kind)
           VALUES ($1, $2, 'CASH', 'Tunai', 'CASH') RETURNING id`,
          [created.tenantId, v],
        )
      ).rows[0]!.id
    const existingQris = await c.query<{ id: string }>(
      `SELECT id FROM payment_method WHERE tenant_id = $1 AND code = 'QRIS' AND deleted_at IS NULL LIMIT 1`,
      [created.tenantId],
    )
    const qrisMethodId =
      existingQris.rows[0]?.id ??
      (
        await c.query<{ id: string }>(
          `INSERT INTO payment_method (tenant_id, version, code, name, kind)
           VALUES ($1, $2, 'QRIS', 'QRIS', 'NON_CASH') RETURNING id`,
          [created.tenantId, v],
        )
      ).rows[0]!.id

    const ppnId = (
      await c.query<{ id: string }>(
        `INSERT INTO tax_rate_history (tenant_id, version, tax_code, outlet_id, effective_from, rate)
         VALUES ($1, $2, 'PPN', $3, '2026-01-01', 11.0000) RETURNING id`,
        [created.tenantId, v, outlet.id],
      )
    ).rows[0]!.id
    const pb1Id = (
      await c.query<{ id: string }>(
        `INSERT INTO tax_rate_history (tenant_id, version, tax_code, outlet_id, effective_from, rate)
         VALUES ($1, $2, 'PB1', $3, '2026-01-01', 10.0000) RETURNING id`,
        [created.tenantId, v, outlet.id],
      )
    ).rows[0]!.id

    // Open a cashier shift
    const shiftId = idGen.newId()
    if (regType === 'CASHIER') {
      const shiftCmdId = idGen.newId()
      await c.query(
        `INSERT INTO idempotency_command (command_id, tenant_id, device_id, register_id, outlet_id, command_type, schema_version, device_seq, payload_hash, status, result)
         VALUES ($1, $2, $3, $4, $5, 'OpenShift', 1, 0, repeat('a', 64), 'ACKED', '{}'::jsonb)`,
        [shiftCmdId, created.tenantId, enrolled.device_id, reg.id, outlet.id],
      )
      await c.query(
        `INSERT INTO cash_cashier (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version, opening_cash)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-20', $7, 1, 300000)`,
        [shiftId, created.tenantId, outlet.id, reg.id, enrolled.device_id, actor.appUserId, shiftCmdId],
      )
    }

    return {
      skus,
      pcsId,
      cashMethodId,
      qrisMethodId,
      ppnId,
      pb1Id,
      shiftId,
      version: v,
    }
  })

  return { tenantId: created.tenantId, actor, le, outlet, reg, syncDevice, ...seeded }
}

function buildSaleEnvelopeFromVector(
  env: Awaited<ReturnType<typeof setupSaleEnv>>,
  params: {
    calcInput: SaleCalcInput
    paymentsInput: readonly PaymentInput[]
    deviceSeq: number
    invoiceSeq: number
    businessDate?: string
    occurredAt?: string
    catalogCursor?: number | null
    prefix?: string
    mutatePayload?: (p: Record<string, unknown>) => void
  },
): PushCommandEnvelope {
  const { calc, settlement } = calcAndSettle(params.calcInput, params.paymentsInput, 100)
  const bd = params.businessDate ?? '2026-11-20'
  const period = invoicePeriod(bd)
  const prefix = params.prefix ?? 'OUT01-POS01'
  const saleId = idGen.newId()
  const occurredAt = params.occurredAt ?? '2026-11-20T10:00:00.000Z'
  const billDisc = params.calcInput.billDiscount
  const taxProfile = params.calcInput.config.taxProfile

  const payload = {
    sale: {
      id: saleId,
      shift_id: env.shiftId,
      created_by: env.actor.appUserId,
      created_at_device: occurredAt,
      clock_offset_ms: 0,
      occurred_at: occurredAt,
      business_date: bd,
      invoice_no: formatInvoiceNo({ prefix, kind: 'INVOICE', period, seq: params.invoiceSeq }),
      invoice_prefix: prefix,
      invoice_period: period,
      invoice_seq: params.invoiceSeq,
      legal_entity_id: env.le.id,
      legal_entity_npwp: env.le.npwp,
      legal_entity_is_pkp: env.le.isPkp,
      price_tax_mode: params.calcInput.config.priceTaxMode,
      tax_profile: taxProfile,
      tax_rate: params.calcInput.config.taxRate,
      tax_rate_id: taxProfile === 'PPN' ? env.ppnId : taxProfile === 'PB1' ? env.pb1Id : null,
      service_charge_rate: params.calcInput.config.serviceChargeRate,
      service_charge_taxable: params.calcInput.config.serviceChargeTaxable,
      cash_rounding_unit: 100,
      receipt_locale: 'id-ID',
      currency: 'IDR',
      gross_total: calc.grossTotal,
      line_discount_total: calc.lineDiscountTotal,
      bill_discount_type: billDisc ? billDisc.kind : null,
      bill_discount_pct: billDisc?.kind === 'PERCENT' ? billDisc.percent : null,
      bill_discount_input: billDisc?.kind === 'NOMINAL' ? billDisc.amount : null,
      bill_discount_total: calc.billDiscountTotal,
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
      catalog_cursor: params.catalogCursor ?? env.version,
      bill_id: null,
      bill_ref: null,
    },
    lines: params.calcInput.lines.map((cl, i) => {
      const lc = calc.lines[i]!
      const skuInfo = env.skus[cl.skuId]!
      return {
        id: idGen.newId(),
        line_no: cl.lineNo,
        line_kind: 'ITEM',
        product_id: skuInfo.productId,
        sku_id: skuInfo.skuId,
        uom_id: env.pcsId,
        sku_code: skuInfo.code,
        item_name: skuInfo.name,
        uom_code: 'PCS',
        qty: cl.qty,
        conversion_factor: '1.0000',
        qty_base: cl.qty,
        unit_price: cl.unitPrice,
        price_source: cl.isOpenPrice ? 'OPEN_PRICE' : 'OUTLET',
        is_open_price: Boolean(cl.isOpenPrice),
        taxable: cl.taxable,
        discount_type: cl.discount ? cl.discount.kind : null,
        discount_pct: cl.discount?.kind === 'PERCENT' ? cl.discount.percent : null,
        discount_input: cl.discount?.kind === 'NOMINAL' ? cl.discount.amount : null,
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
    payments: (() => {
      const lastCashIdx = settlement.payments.map((x) => x.kind).lastIndexOf('CASH')
      return settlement.payments.map((ap, idx) => ({
        id: idGen.newId(),
        seq: idx + 1,
        method_id: ap.kind === 'CASH' ? env.cashMethodId : env.qrisMethodId,
        method_code: ap.methodCode,
        method_name: ap.kind === 'CASH' ? 'Tunai' : 'QRIS',
        method_kind: ap.kind,
        amount_applied: ap.applied,
        cash_tendered: ap.kind === 'CASH' ? ap.tendered : null,
        change_given: ap.kind === 'CASH' ? ap.change : null,
        reference: ap.reference,
        is_rounding_settler: idx === lastCashIdx,
      }))
    })(),
  }

  if (params.mutatePayload) {
    params.mutatePayload(payload as Record<string, unknown>)
  }

  return {
    id: saleId,
    type: 'FinalizeSale',
    schema_version: 1,
    device_seq: params.deviceSeq,
    depends_on: [],
    created_at_device: occurredAt,
    payload,
  }
}

describe('FinalizeSale handler integration (V-04..V-30, idempotency, flags, auth, perf)', () => {
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

  it('persists V-04, V-05, V-06, V-07, V-08, V-11, V-30 identically and guarantees 5x idempotent replay (FR-QA-003)', async () => {
    const env = await setupSaleEnv(uniqueSlug('fs-vecs'))
    const vMap = new Map(SALES_CALC_VECTORS.map((v) => [v.id, v]))
    const expectedDueByVec: Record<string, number> = {
      'V-04': 112500,
      'V-05': 101300,
      'V-06': 135700,
      'V-07': 135100,
      'V-08': 123300,
      'V-11': 135700,
      'V-30': 54900,
    }

    const targets: Array<{ label: string; vecId: string; payments?: readonly PaymentInput[] }> = [
      { label: 'V-04', vecId: 'V-04' },
      { label: 'V-05', vecId: 'V-05' },
      { label: 'V-06', vecId: 'V-06' },
      { label: 'V-07', vecId: 'V-07' },
      { label: 'V-08', vecId: 'V-08' },
      {
        label: 'V-11',
        vecId: 'V-06',
        payments: [
          { methodCode: 'QRIS', kind: 'NON_CASH', amount: toMoney(100000), reference: 'QR-11' },
          { methodCode: 'CASH', kind: 'CASH', amount: toMoney(50000) },
        ],
      },
      { label: 'V-30', vecId: 'V-30' },
    ]

    let seq = 1
    let v04Cmd!: PushCommandEnvelope
    let v04Ack!: Record<string, unknown>

    for (const t of targets) {
      const vec = vMap.get(t.vecId)!
      const cmd = buildSaleEnvelopeFromVector(env, {
        calcInput: vec.input,
        paymentsInput: t.payments ?? vec.settlement!.payments,
        deviceSeq: seq,
        invoiceSeq: seq,
      })
      const res = await processPush(
        env.syncDevice,
        { sent_at_device: '2026-11-20T10:05:00.000Z', clock_offset_ms: 0, commands: [cmd] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `req-vec-${seq}` },
      )
      expect(res.results[0]!.outcome).toBe('ACK')
      const ack = res.results[0] as { outcome: 'ACK'; result: Record<string, unknown> }
      expect(ack.result.flags).toEqual([])

      if (t.label === 'V-04') {
        v04Cmd = cmd
        v04Ack = ack.result
      }

      const payloadObj = cmd.payload as {
        sale: Record<string, unknown>
        lines: Array<Record<string, unknown>>
      }
      await withTenant(env.tenantId, async (tx) => {
        const sRow = await tx.execute(`SELECT * FROM sale WHERE id = '${cmd.id}'`)
        expect(sRow.rows).toHaveLength(1)
        const r = sRow.rows[0] as Record<string, unknown>
        expect(Number(r.total_due)).toBe(expectedDueByVec[t.label]!)
        expect(Number(r.gross_total)).toBe(payloadObj.sale.gross_total)
        expect(Number(r.net_subtotal)).toBe(payloadObj.sale.net_subtotal)
        expect(Number(r.service_charge)).toBe(payloadObj.sale.service_charge)
        expect(Number(r.tax_amount)).toBe(payloadObj.sale.tax_amount)
        expect(Number(r.dpp)).toBe(payloadObj.sale.dpp)
        expect(Number(r.grand_total)).toBe(payloadObj.sale.grand_total)
        expect(Number(r.rounding)).toBe(payloadObj.sale.rounding)

        const lRows = await tx.execute(
          `SELECT * FROM sale_line WHERE sale_id = '${cmd.id}' ORDER BY line_no ASC`,
        )
        expect(lRows.rows).toHaveLength(payloadObj.lines.length)
        payloadObj.lines.forEach((pl, idx) => {
          const lr = lRows.rows[idx] as Record<string, unknown>
          expect(Number(lr.line_gross)).toBe(pl.line_gross)
          expect(Number(lr.line_net)).toBe(pl.line_net)
          expect(Number(lr.bill_discount_alloc)).toBe(pl.bill_discount_alloc)
          expect(Number(lr.service_alloc)).toBe(pl.service_alloc)
          expect(Number(lr.tax_alloc)).toBe(pl.tax_alloc)
        })
      })

      seq += 1
    }

    // Idempotency: replay V-04 4 more times -> still 1 row & identical ACK result
    for (let r = 0; r < 4; r += 1) {
      const replay = await processPush(
        env.syncDevice,
        { sent_at_device: '2026-11-20T10:10:00.000Z', clock_offset_ms: 0, commands: [v04Cmd] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `req-r-${r}` },
      )
      expect(replay.results[0]).toEqual({ id: v04Cmd.id, outcome: 'ACK', result: v04Ack })
    }
    await withTenant(env.tenantId, async (tx) => {
      const cnt = await tx.execute(`SELECT count(*)::int AS c FROM sale WHERE id = '${v04Cmd.id}'`)
      expect(Number(cnt.rows[0]!.c)).toBe(1)
    })
  })

  it('evaluates SELISIH_HITUNG (EC-029), HARGA_STALE, ITEM_TIDAK_TERSEDIA (V-28), ITEM_NONAKTIF, and TARIF_BERBEDA without altering figures', async () => {
    const env = await setupSaleEnv(uniqueSlug('fs-flags'))
    const v04 = SALES_CALC_VECTORS.find((v) => v.id === 'V-04')!
    const v30 = SALES_CALC_VECTORS.find((v) => v.id === 'V-30')!

    // 1. EC-029: tax_amount +1, grand_total +1, payment +1 -> SELISIH_HITUNG flag, client numbers preserved
    const ec029Cmd = buildSaleEnvelopeFromVector(env, {
      calcInput: v04.input,
      paymentsInput: [{ methodCode: 'CASH', kind: 'CASH', amount: toMoney(150000) }],
      deviceSeq: 1,
      invoiceSeq: 1,
      mutatePayload: (p) => {
        const s = p.sale as Record<string, number>
        s.tax_amount = (s.tax_amount ?? 0) + 1
        s.grand_total = (s.grand_total ?? 0) + 1
        s.rounding = (s.rounding ?? 0) - 1
      },
    })
    const ecRes = await processPush(
      env.syncDevice,
      { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [ec029Cmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-ec029' },
    )
    const ecItem = ecRes.results[0]!
    expect(ecItem.outcome).toBe('ACK')
    if (ecItem.outcome !== 'ACK') throw new Error('expected ACK')
    expect(ecItem.result.flags as string[]).toContain('SELISIH_HITUNG')

    // 2. HARGA_STALE (18.500 -> 19.000 x2 = -1.000), ITEM_TIDAK_TERSEDIA (V-28), ITEM_NONAKTIF, TARIF_BERBEDA (12%)
    await masterTx(env.tenantId, async (c, v) => {
      // Price up kopi from 18500 -> 19000
      await c.query(
        `UPDATE price_entry SET price = 19000, version = $1 WHERE tenant_id = $2 AND sku_id = $3`,
        [v, env.tenantId, env.skus['sku-kopi']!.skuId],
      )
      // Mark gula unavailable at version v @ 13:00Z
      await c.query(
        `INSERT INTO item_outlet_availability (tenant_id, version, outlet_id, product_id, sku_id, status, changed_at)
         VALUES ($1, $2, $3, $4, NULL, 'UNAVAILABLE', '2026-11-20T13:00:00.000Z')
         ON CONFLICT (outlet_id, product_id, sku_id) DO UPDATE SET status = 'UNAVAILABLE', version = $2, changed_at = '2026-11-20T13:00:00.000Z'`,
        [env.tenantId, v, env.outlet.id, env.skus['sku-gula']!.productId],
      )
      // Deactivate susu
      await c.query(
        `UPDATE sku SET is_active = false, version = $1 WHERE tenant_id = $2 AND id = $3`,
        [v, env.tenantId, env.skus['sku-susu']!.skuId],
      )
      // New PPN rate 12% effective 2026-11-15
      await c.query(
        `INSERT INTO tax_rate_history (tenant_id, version, tax_code, outlet_id, effective_from, rate)
         VALUES ($1, $2, 'PPN', $3, '2026-11-15', 12.0000)`,
        [env.tenantId, v, env.outlet.id],
      )
    })

    // Sale AFTER 13:00Z with stale catalog_cursor => triggers all 4 flags (V-28)
    const afterCmd = buildSaleEnvelopeFromVector(env, {
      calcInput: v04.input,
      paymentsInput: v04.settlement!.payments,
      deviceSeq: 2,
      invoiceSeq: 2,
      occurredAt: '2026-11-20T14:00:00.000Z',
      catalogCursor: env.version,
    })
    const afterRes = await processPush(
      env.syncDevice,
      { sent_at_device: '2026-11-20T14:05:00.000Z', clock_offset_ms: 0, commands: [afterCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-after' },
    )
    const afterItem = afterRes.results[0]!
    if (afterItem.outcome !== 'ACK') throw new Error('expected ACK')
    expect((afterItem.result.flags as string[]).sort()).toEqual([
      'HARGA_STALE',
      'ITEM_NONAKTIF',
      'ITEM_TIDAK_TERSEDIA',
      'TARIF_BERBEDA',
    ])

    await withTenant(env.tenantId, async (tx) => {
      const staleRow = await tx.execute(
        `SELECT diff_amount FROM data_flag WHERE tenant_id = '${env.tenantId}' AND flag_code = 'HARGA_STALE' AND parent_id = '${afterCmd.id}'`,
      )
      expect(Number(staleRow.rows[0]!.diff_amount)).toBe(-1000)
    })

    // V-28: Sale BEFORE changedAt (12:30Z < 13:00Z) must NOT raise ITEM_TIDAK_TERSEDIA, and OPEN_PRICE not HARGA_STALE
    const beforeCmd = buildSaleEnvelopeFromVector(env, {
      calcInput: {
        ...v30.input,
        lines: [
          { ...v30.input.lines[1]!, lineNo: 1 },
          { lineNo: 2, skuId: 'sku-gula', uomId: 'uom-pcs', qty: parseQty('1'), unitPrice: toMoney(16000), taxable: true },
        ],
      },
      paymentsInput: [{ methodCode: 'CASH', kind: 'CASH', amount: toMoney(50000) }],
      deviceSeq: 3,
      invoiceSeq: 3,
      occurredAt: '2026-11-20T12:30:00.000Z',
      catalogCursor: env.version,
    })
    const beforeRes = await processPush(
      env.syncDevice,
      { sent_at_device: '2026-11-20T14:06:00.000Z', clock_offset_ms: 0, commands: [beforeCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-before' },
    )
    const beforeItem = beforeRes.results[0]!
    if (beforeItem.outcome !== 'ACK') throw new Error('expected ACK')
    expect(beforeItem.result.flags as string[]).not.toContain('ITEM_TIDAK_TERSEDIA')
    expect(beforeItem.result.flags as string[]).not.toContain('HARGA_STALE')
  })

  it('rejects structural & authorization violations cleanly (PAYMENT_MISMATCH, UNKNOWN_REFERENCE, cross-register shift, WAITER, bad invoice_no) and enforces RLS', async () => {
    const envA = await setupSaleEnv(uniqueSlug('fs-rej-a'))
    const envB = await setupSaleEnv(uniqueSlug('fs-rej-b'))
    const waiterEnv = await setupSaleEnv(uniqueSlug('fs-waiter'), { registerType: 'WAITER' })
    const v04 = SALES_CALC_VECTORS.find((v) => v.id === 'V-04')!

    // 1. PAYMENT_MISMATCH -> ATTENTION and zero sales committed
    const mismatchCmd = buildSaleEnvelopeFromVector(envA, {
      calcInput: v04.input,
      paymentsInput: v04.settlement!.payments,
      deviceSeq: 1,
      invoiceSeq: 1,
      mutatePayload: (p) => {
        const pay = (p.payments as Array<Record<string, number>>)[0]!
        pay.amount_applied = (pay.amount_applied ?? 0) - 100
      },
    })
    const rMismatch = await processPush(
      envA.syncDevice,
      { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [mismatchCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-mm' },
    )
    expect(rMismatch.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'PAYMENT_MISMATCH',
    })
    await withTenant(envA.tenantId, async (tx) => {
      const cnt = await tx.execute(`SELECT count(*)::int AS c FROM sale WHERE id = '${mismatchCmd.id}'`)
      expect(Number(cnt.rows[0]!.c)).toBe(0)
    })

    // 2. Unknown SKU (belongs to tenant B) -> UNKNOWN_REFERENCE
    const badSkuCmd = buildSaleEnvelopeFromVector(envA, {
      calcInput: v04.input,
      paymentsInput: v04.settlement!.payments,
      deviceSeq: 2,
      invoiceSeq: 2,
      mutatePayload: (p) => {
        const lines = p.lines as Array<Record<string, unknown>>
        lines[0]!.sku_id = envB.skus['sku-kopi']!.skuId
      },
    })
    const rBadSku = await processPush(
      envA.syncDevice,
      { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [badSkuCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-badsku' },
    )
    expect(rBadSku.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'UNKNOWN_REFERENCE',
    })

    // 3. Mismatched invoice_no -> VALIDATION_FAILED
    const badInvCmd = buildSaleEnvelopeFromVector(envA, {
      calcInput: v04.input,
      paymentsInput: v04.settlement!.payments,
      deviceSeq: 3,
      invoiceSeq: 3,
      mutatePayload: (p) => {
        const s = p.sale as Record<string, unknown>
        s.invoice_no = 'OUT01-POS01-1126-999999'
      },
    })
    const rBadInv = await processPush(
      envA.syncDevice,
      { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [badInvCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-badinv' },
    )
    expect(rBadInv.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'VALIDATION_FAILED',
    })

    // 4. Shift belonging to second register in same tenant -> AUTHORIZATION FORBIDDEN
    const reg2 = await createRegister(envA.actor, {
      outletId: envA.outlet.id,
      code: 'POS02',
      name: 'Kasir 2',
      registerType: 'CASHIER',
      invoicePrefix: 'OUT01-POS02',
    })
    const pairing2 = await createPairingCode(envA.actor, reg2.id)
    const dev2 = await enrollDevice(
      { slug: envA.actor.tenantSlug, code: pairing2.code, device_name: 'POS2' },
      '10.4.0.2',
      { minDelayMs: 0 },
    )
    const syncDev2: SyncDeviceIdentity = {
      tenantId: envA.tenantId,
      deviceId: dev2.device_id,
      registerId: reg2.id,
      outletId: envA.outlet.id,
      registerType: 'CASHIER',
    }
    const crossShiftCmd = buildSaleEnvelopeFromVector(envA, {
      calcInput: v04.input,
      paymentsInput: v04.settlement!.payments,
      deviceSeq: 1,
      invoiceSeq: 1,
      prefix: 'OUT01-POS02',
    })
    const rCrossShift = await processPush(
      syncDev2,
      { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [crossShiftCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-xs' },
    )
    expect(rCrossShift.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'AUTHORIZATION',
      reason_code: 'FORBIDDEN',
    })

    // 5. WAITER register rejected by pipeline
    const waiterCmd = buildSaleEnvelopeFromVector(envA, {
      calcInput: v04.input,
      paymentsInput: v04.settlement!.payments,
      deviceSeq: 1,
      invoiceSeq: 1,
    })
    const rWaiter = await processPush(
      waiterEnv.syncDevice,
      { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [waiterCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-wtr' },
    )
    expect(rWaiter.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'AUTHORIZATION',
      reason_code: 'FORBIDDEN',
    })

    // 6. Valid sale + RLS check from tenant B
    const validCmd = buildSaleEnvelopeFromVector(envA, {
      calcInput: v04.input,
      paymentsInput: v04.settlement!.payments,
      deviceSeq: 4,
      invoiceSeq: 4,
    })
    const rValid = await processPush(
      envA.syncDevice,
      { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [validCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'req-ok' },
    )
    expect(rValid.results[0]!.outcome).toBe('ACK')

    await withClient(appClient, async (c) => {
      await c.query('BEGIN')
      try {
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [envB.tenantId])
        const seeA = await c.query(`SELECT count(*)::int AS c FROM sale WHERE id = $1`, [validCmd.id])
        expect(Number(seeA.rows[0]!.c)).toBe(0)
        await c.query('COMMIT')
      } finally {
        await c.query('ROLLBACK')
      }
    })
  })

  it('meets FinalizeSale single-command throughput target (p95 <= 800ms soft CI / <= 500ms NFR) across 200 sequential sales', async () => {
    const env = await setupSaleEnv(uniqueSlug('fs-perf'))
    const v04 = SALES_CALC_VECTORS.find((v) => v.id === 'V-04')!
    const durations: number[] = []

    for (let i = 1; i <= 200; i += 1) {
      const cmd = buildSaleEnvelopeFromVector(env, {
        calcInput: v04.input,
        paymentsInput: v04.settlement!.payments,
        deviceSeq: i,
        invoiceSeq: i,
      })
      const start = performance.now()
      const res = await processPush(
        env.syncDevice,
        { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [cmd] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `perf-${i}` },
      )
      durations.push(performance.now() - start)
      expect(res.results[0]!.outcome).toBe('ACK')
    }

    const sorted = [...durations].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length * 0.5)]!
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!
    console.info(`FinalizeSale 200x sequential latency: p50=${p50.toFixed(1)}ms, p95=${p95.toFixed(1)}ms`)
    expect(p95).toBeLessThanOrEqual(800)
  }, 60_000)
})
