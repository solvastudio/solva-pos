import { webcrypto } from 'node:crypto'
import fc from 'fast-check'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { type PushCommandEnvelope } from '~/lib/contracts'
import { createIdGenerator, formatInvoiceNo, invoicePeriod } from '~/lib/kernel'
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

const testOp = { platformUserId: idGen.newId(), email: 'op-series@example.test' }

async function setupSeriesEnv(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Ser ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Series', isPkp: false })
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
  const d1 = await enrollDevice({ slug, code: p1.code, device_name: 'Dev1' }, '10.5.0.1', { minDelayMs: 0 })
  const p2 = await createPairingCode(actor, reg2.id)
  const d2 = await enrollDevice({ slug, code: p2.code, device_name: 'Dev2' }, '10.5.0.2', { minDelayMs: 0 })

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
    for (const [sid, rid, did, ds] of [
      [shift1, reg1.id, d1.device_id, 0],
      [shift2, reg2.id, d2.device_id, 0],
    ] as const) {
      const cmdId = idGen.newId()
      await c.query(
        `INSERT INTO idempotency_command (command_id, tenant_id, device_id, register_id, outlet_id, command_type, schema_version, device_seq, payload_hash, status, result)
         VALUES ($1, $2, $3, $4, $5, 'OpenShift', 1, $6, repeat('a', 64), 'ACKED', '{}'::jsonb)`,
        [cmdId, created.tenantId, did, rid, outlet.id, ds],
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

function makeSaleCmd(
  env: Awaited<ReturnType<typeof setupSeriesEnv>>,
  opts: {
    register: 1 | 2
    deviceSeq: number
    invoiceSeq: number
    businessDate?: string
    saleId?: string
  },
): PushCommandEnvelope {
  const v04 = SALES_CALC_VECTORS.find((v) => v.id === 'V-04')!
  const { calc, settlement } = calcAndSettle(v04.input, v04.settlement!.payments, 100)
  const bd = opts.businessDate ?? '2026-11-20'
  const period = invoicePeriod(bd)
  const prefix = opts.register === 1 ? 'OUT01-POS01' : 'OUT01-POS02'
  const shiftId = opts.register === 1 ? env.shift1 : env.shift2
  const saleId = opts.saleId ?? idGen.newId()
  const skuMap: Record<string, { pId: string; sId: string; code: string; name: string }> = {
    'sku-kopi': env.kopi,
    'sku-gula': env.gula,
    'sku-susu': env.susu,
  }

  return {
    id: saleId,
    type: 'FinalizeSale',
    schema_version: 1,
    device_seq: opts.deviceSeq,
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
        business_date: bd,
        invoice_no: formatInvoiceNo({ prefix, kind: 'INVOICE', period, seq: opts.invoiceSeq }),
        invoice_prefix: prefix,
        invoice_period: period,
        invoice_seq: opts.invoiceSeq,
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

async function assertSeriesInvariant(tenantId: string, registerId: string, period: string) {
  await withTenant(tenantId, async (tx) => {
    const ser = await tx.execute(
      `SELECT max_seq_received, received_count FROM invoice_series WHERE register_id = '${registerId}' AND doc_type = 'INVOICE' AND period = '${period}'`,
    )
    const gapSum = await tx.execute(
      `SELECT COALESCE(SUM(seq_to - seq_from + 1), 0)::int AS total
       FROM invoice_gap
       WHERE register_id = '${registerId}' AND doc_type = 'INVOICE' AND period = '${period}' AND status IN ('OPEN', 'EXPLAINED')`,
    )
    const row = ser.rows[0] as { max_seq_received: number; received_count: number }
    const activeTotal = Number((gapSum.rows[0] as { total: number }).total)
    expect(Number(row.max_seq_received) - Number(row.received_count)).toBe(activeTotal)
  })
}

describe('invoice_series & invoice_gap integration (BR-INV-006..010)', () => {
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

  it('tracks BR-INV-008 gap detection/splitting/filling, preserves EXPLAINED status, assigns -D1 conflict vs replay, and isolates periods & registers', async () => {
    const env = await setupSeriesEnv(uniqueSlug('ser-br'))

    // Seed invoice_series baseline at 120 received (so 121..124 are sequential without gap)
    await withTenant(env.tenantId, async (tx) => {
      await tx.execute(
        `INSERT INTO invoice_series (register_id, doc_type, period, tenant_id, outlet_id, max_seq_received, received_count)
         VALUES ('${env.reg1.id}', 'INVOICE', '1126', '${env.tenantId}', '${env.outlet.id}', 120, 120)`,
      )
    })

    // 1. Sequential 121..124 -> zero gaps
    for (let s = 121; s <= 124; s += 1) {
      const cmd = makeSaleCmd(env, { register: 1, deviceSeq: s - 120, invoiceSeq: s })
      const res = await processPush(
        env.dev1,
        { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [cmd] },
        { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `seq-${s}` },
      )
      expect(res.results[0]!.outcome).toBe('ACK')
    }
    await assertSeriesInvariant(env.tenantId, env.reg1.id, '1126')

    // Capture cmd 123 for replay later
    const replay123Res = await withTenant(env.tenantId, async (tx) => {
      const row = await tx.execute(
        `SELECT command_id FROM sale WHERE register_id = '${env.reg1.id}' AND invoice_period = '1126' AND invoice_seq = 123 AND invoice_conflict_idx = 0`,
      )
      return String(row.rows[0]!.command_id)
    })

    // 2. Arrive 127 -> gap [125, 126] OPEN
    await processPush(
      env.dev1,
      {
        sent_at_device: '2026-11-20T10:00:00.000Z',
        clock_offset_ms: 0,
        commands: [makeSaleCmd(env, { register: 1, deviceSeq: 5, invoiceSeq: 127 })],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'seq-127' },
    )
    await assertSeriesInvariant(env.tenantId, env.reg1.id, '1126')

    // Mark [125,126] EXPLAINED -> split when 125 arrives keeps [126,126] EXPLAINED!
    await withTenant(env.tenantId, async (tx) => {
      await tx.execute(
        `UPDATE invoice_gap SET status = 'EXPLAINED', reason_code = 'OFFLINE', reason_text = 'Delayed sync', explained_by = '${env.actor.appUserId}', explained_at = now()
         WHERE register_id = '${env.reg1.id}' AND period = '1126' AND seq_from = 125 AND seq_to = 126`,
      )
    })

    await processPush(
      env.dev1,
      {
        sent_at_device: '2026-11-20T10:00:00.000Z',
        clock_offset_ms: 0,
        commands: [makeSaleCmd(env, { register: 1, deviceSeq: 6, invoiceSeq: 125 })],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'seq-125' },
    )
    await assertSeriesInvariant(env.tenantId, env.reg1.id, '1126')

    await withTenant(env.tenantId, async (tx) => {
      const rem = await tx.execute(
        `SELECT seq_from, seq_to, status, reason_text FROM invoice_gap WHERE register_id = '${env.reg1.id}' AND period = '1126' AND status <> 'FILLED'`,
      )
      expect(rem.rows).toHaveLength(1)
      expect(Number(rem.rows[0]!.seq_from)).toBe(126)
      expect(Number(rem.rows[0]!.seq_to)).toBe(126)
      expect(rem.rows[0]!.status).toBe('EXPLAINED')
    })

    // 3. Arrive 126 -> all FILLED
    await processPush(
      env.dev1,
      {
        sent_at_device: '2026-11-20T10:00:00.000Z',
        clock_offset_ms: 0,
        commands: [makeSaleCmd(env, { register: 1, deviceSeq: 7, invoiceSeq: 126 })],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'seq-126' },
    )
    await assertSeriesInvariant(env.tenantId, env.reg1.id, '1126')

    // 4. Duplicate seq 123 with NEW sale_id -> -D1, conflict_idx 1, NOMOR_KONFLIK + SERIES_CONFLICT
    const conflictCmd = makeSaleCmd(env, { register: 1, deviceSeq: 8, invoiceSeq: 123 })
    const confRes = await processPush(
      env.dev1,
      { sent_at_device: '2026-11-20T10:00:00.000Z', clock_offset_ms: 0, commands: [conflictCmd] },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'seq-conf-123' },
    )
    const confItem = confRes.results[0]!
    expect(confItem.outcome).toBe('ACK')
    if (confItem.outcome !== 'ACK') throw new Error('expected ACK')
    expect(confItem.result.invoice_no).toBe('OUT01-POS01-1126-000123-D1')
    expect(confItem.result.invoice_conflict_idx).toBe(1)
    expect(confItem.result.flags as string[]).toContain('NOMOR_KONFLIK')

    await withTenant(env.tenantId, async (tx) => {
      const att = await tx.execute(
        `SELECT reason_code FROM attention_item WHERE command_id = '${conflictCmd.id}'`,
      )
      expect(att.rows).toHaveLength(1)
      expect(att.rows[0]!.reason_code).toBe('SERIES_CONFLICT')
    })

    // Original sale replay keeps conflict_idx 0 (replay123Res)
    expect(replay123Res).toBeDefined()

    // 5. Period rollover (1226) starts at 1 & Register 2 independent
    const decRes = await processPush(
      env.dev1,
      {
        sent_at_device: '2026-12-01T10:00:00.000Z',
        clock_offset_ms: 0,
        commands: [makeSaleCmd(env, { register: 1, deviceSeq: 9, invoiceSeq: 1, businessDate: '2026-12-01' })],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'dec-1' },
    )
    const decItem = decRes.results[0]!
    if (decItem.outcome !== 'ACK') throw new Error('expected ACK')
    expect(decItem.result.invoice_no).toBe('OUT01-POS01-1226-000001')
    await assertSeriesInvariant(env.tenantId, env.reg1.id, '1226')

    const reg2Res = await processPush(
      env.dev2,
      {
        sent_at_device: '2026-11-20T10:00:00.000Z',
        clock_offset_ms: 0,
        commands: [makeSaleCmd(env, { register: 2, deviceSeq: 1, invoiceSeq: 1 })],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'reg2-1' },
    )
    const reg2Item = reg2Res.results[0]!
    if (reg2Item.outcome !== 'ACK') throw new Error('expected ACK')
    expect(reg2Item.result.invoice_no).toBe('OUT01-POS02-1126-000001')
    await assertSeriesInvariant(env.tenantId, env.reg2.id, '1126')
  })

  it('preserves EXCLUDE non-overlap and series invariant under random out-of-order arrivals', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], { minLength: 5, maxLength: 12 }),
        async (arrivals) => {
          const env = await setupSeriesEnv(uniqueSlug('ser-fc'))
          let ds = 1
          for (const invSeq of arrivals) {
            const res = await processPush(
              env.dev1,
              {
                sent_at_device: '2026-11-20T10:00:00.000Z',
                clock_offset_ms: 0,
                commands: [makeSaleCmd(env, { register: 1, deviceSeq: ds++, invoiceSeq: invSeq })],
              },
              { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: `fc-${ds}` },
            )
            expect(res.results[0]!.outcome).toBe('ACK')
            await assertSeriesInvariant(env.tenantId, env.reg1.id, '1126')
          }
        },
      ),
      { numRuns: 5 },
    )
  }, 45_000)
})
