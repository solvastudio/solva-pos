import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { type PushCommandEnvelope } from '~/lib/contracts'
import { createIdGenerator } from '~/lib/kernel'
import { calcAndSettle, calcSale, verifySale } from '~/lib/sales-calc'
import { SALES_CALC_VECTORS } from '~/lib/sales-calc/sales-calc.vectors'
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
import { annotateGap, listGaps, recoverRegister } from '~/modules/sales/public'
import { processPush, type SyncDeviceIdentity } from '~/modules/sync/public'
import { evaluateRelease } from '~/pos/sync/release-state'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
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

const RECOVERY_NOW = '2026-11-20T12:00:00.000Z'

/**
 * Membuat tenant + owner + outlet + legal entity + register (sama seperti pola tes F3 lain).
 * Mengembalikan actor OWNER dan identitas penjualan.
 */
async function setupOwnerOutlet(slug: string, legalName: string) {
  const testOp = { platformUserId: idGen.newId(), email: `${slug}@example.test` }
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `${legalName} ${slug}`,
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
    password: 'Password123!',
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
  const le = await createLegalEntity(actor, { name: legalName, isPkp: false })
  const outlet = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })
  return { created, actor, le, outlet }
}

describe('F3 Server Acceptance Suite (12 Criteria mapping)', () => {
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

  it('F3-K02: seluruh vektor sales-calc (V-04..V-09, V-30) konsisten pada calc dan verifySale server', () => {
    for (const vector of SALES_CALC_VECTORS) {
      const cashRoundingUnit = vector.settlement?.cashRoundingUnit ?? 100

      // Figur bill (calcSale) harus persis sesuai nilai kanonik vektor.
      const calc = calcSale(vector.input)
      for (const key of [
        'grossTotal',
        'lineDiscountTotal',
        'netSubtotal',
        'taxBase',
        'taxAmount',
        'dpp',
        'grandTotal',
      ] as const) {
        const expected = vector.expected[key]
        if (expected !== undefined) {
          expect(calc[key], `${vector.id} ${key}`).toBe(expected)
        }
      }

      if (!vector.settlement) continue

      // Pembayaran, pembulatan tunai, dan verifikasi angka (verifySale dipakai server).
      const payments = vector.settlement.payments
      const { calc: settledCalc, settlement } = calcAndSettle(vector.input, payments, cashRoundingUnit)
      expect(settlement.rounding, `${vector.id} rounding`).toBe(vector.settlement.expected.rounding)
      expect(settlement.totalDue, `${vector.id} totalDue`).toBe(vector.settlement.expected.totalDue)
      expect(settlement.changeTotal, `${vector.id} changeTotal`).toBe(vector.settlement.expected.changeTotal)
      expect(settlement.payments.map((p) => p.applied), `${vector.id} applied`).toEqual(
        vector.settlement.expected.applied,
      )

      const verifyRes = verifySale({
        input: vector.input,
        payments,
        cashRoundingUnit,
        stored: {
          grossTotal: settledCalc.grossTotal,
          lineDiscountTotal: settledCalc.lineDiscountTotal,
          billDiscountTotal: settledCalc.billDiscountTotal,
          netSubtotal: settledCalc.netSubtotal,
          serviceCharge: settledCalc.serviceCharge,
          taxBase: settledCalc.taxBase,
          taxAmount: settledCalc.taxAmount,
          dpp: settledCalc.dpp,
          grandTotal: settledCalc.grandTotal,
          rounding: settlement.rounding,
          totalDue: settlement.totalDue,
          lines: settledCalc.lines,
        },
      })
      expect(verifyRes.ok, `${vector.id} verifySale`).toBe(true)
    }
  })

  it('F3-K05: recovery registrasi mencatat gap RECOVERY_DECLARED dan anotasi manajer mengubah status ke EXPLAINED', async () => {
    const slug = uniqueSlug('f3-k05')
    const { actor, outlet } = await setupOwnerOutlet(slug, 'PT K05')
    const reg = await createRegister(actor, {
      outletId: outlet.id,
      code: 'POS01',
      name: 'Register 1',
      registerType: 'CASHIER',
      invoicePrefix: 'OUT01-POS01',
    })
    // Recovery memerlukan perangkat lama yang pernah terdaftar pada register ini.
    const pairing = await createPairingCode(actor, reg.id)
    await enrollDevice({ slug, code: pairing.code, device_name: 'POS-K05' }, '10.50.0.9', {
      minDelayMs: 0,
    })

    // Manajer menyatakan register terakhir mencapai nomor 127 (BR-INV-008).
    const recoveryRes = await recoverRegister(
      actor,
      {
        registerId: reg.id,
        reasonCode: 'LOST',
        declaredLastInvoiceSeq: 127,
        reasonText: 'Device replacement after hardware failure',
      },
      { nowIso: () => RECOVERY_NOW },
    )
    expect(recoveryRes.createdGaps.length).toBeGreaterThanOrEqual(1)
    expect(recoveryRes.createdGaps.some((g) => g.docType === 'INVOICE' && g.seqTo === 127)).toBe(true)

    const gaps = await listGaps(actor, { outletId: outlet.id, status: 'OPEN' })
    const gap = gaps.find((g) => g.registerId === reg.id && g.seqTo === 127)
    expect(gap).toBeDefined()
    expect(gap!.origin).toBe('RECOVERY_DECLARED')
    expect(gap!.status).toBe('OPEN')

    const annotated = await annotateGap(
      actor,
      gap!.id,
      {
        reasonCode: 'LOST_DEVICE',
        reasonText: 'Device crashed permanently; invoices written off with police report',
      },
      { nowIso: () => '2026-11-20T12:30:00.000Z' },
    )
    expect(annotated.status).toBe('EXPLAINED')

    const afterAnnotate = await listGaps(actor, { outletId: outlet.id, status: 'EXPLAINED' })
    expect(afterAnnotate.some((g) => g.id === gap!.id && g.reasonCode === 'LOST_DEVICE')).toBe(true)
  })

  it('F3-K07: penjualan offline pada item yang kemudian UNAVAILABLE diterima dan ditandai ITEM_TIDAK_TERSEDIA', async () => {
    const slug = uniqueSlug('f3-k07')
    const { created, actor, le, outlet } = await setupOwnerOutlet(slug, 'PT K07')
    const reg = await createRegister(actor, {
      outletId: outlet.id,
      code: 'POS01',
      name: 'POS 01',
      registerType: 'CASHIER',
      invoicePrefix: 'OUT01-POS01',
    })
    const pairing = await createPairingCode(actor, reg.id)
    const dev = await enrollDevice({ slug, code: pairing.code, device_name: 'POS-K07' }, '10.50.0.1', {
      minDelayMs: 0,
    })

    const syncDevice: SyncDeviceIdentity = {
      tenantId: created.tenantId,
      deviceId: dev.device_id,
      registerId: reg.id,
      outletId: outlet.id,
      registerType: 'CASHIER',
    }

    const { prodKopi, pcsId, cashMethodId } = await masterTx(created.tenantId, async (c, v) => {
      const catId = (
        await c.query<{ id: string }>(
          `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'C') RETURNING id`,
          [created.tenantId, v],
        )
      ).rows[0]!.id
      const pcsId = (
        await c.query<{ id: string }>(
          `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pcs') RETURNING id`,
          [created.tenantId, v],
        )
      ).rows[0]!.id
      const pId = (
        await c.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id) VALUES ($1, $2, $3, 'P1', 'Kopi', $4) RETURNING id`,
          [created.tenantId, v, catId, pcsId],
        )
      ).rows[0]!.id
      const sId = (
        await c.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES ($1, $2, $3, 'SKU1', true) RETURNING id`,
          [created.tenantId, v, pId],
        )
      ).rows[0]!.id
      // Metode bayar CASH sudah di-seed saat tenant dibuat; pakai yang ada (uq tenant+code).
      const cashMethodId = (
        await c.query<{ id: string }>(
          `SELECT id FROM payment_method WHERE tenant_id = $1 AND code = 'CASH' AND deleted_at IS NULL LIMIT 1`,
          [created.tenantId],
        )
      ).rows[0]!.id

      // Item ditandai UNAVAILABLE pada versi lebih baru (09:00 UTC).
      await c.query(
        `INSERT INTO item_outlet_availability (tenant_id, version, product_id, sku_id, outlet_id, status, changed_at)
         VALUES ($1, $2, $3, $4, $5, 'UNAVAILABLE', '2026-11-20T09:00:00.000Z')`,
        [created.tenantId, v, pId, sId, outlet.id],
      )

      return { prodKopi: { pId, sId, code: 'SKU1', name: 'Kopi' }, pcsId, cashMethodId }
    })

    // Buka shift.
    const shiftId = idGen.newId()
    await processPush(
      syncDevice,
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
                created_by: created.ownerInvite.appUserId,
                created_at_device: '2026-11-20T08:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T08:00:00.000Z',
                business_date: '2026-11-20',
                opening_cash: 500000,
              },
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: 'sh-k07' },
    )

    // Penjualan offline pukul 10:00 UTC dengan cursor katalog lama (1 < 10): harus DITERIMA dan ditandai.
    const saleId = idGen.newId()
    const saleCmd: PushCommandEnvelope = {
      id: saleId,
      type: 'FinalizeSale',
      schema_version: 1,
      device_seq: 2,
      depends_on: [],
      created_at_device: '2026-11-20T10:00:00.000Z',
      payload: {
        sale: {
          id: saleId,
          shift_id: shiftId,
          created_by: created.ownerInvite.appUserId,
          created_at_device: '2026-11-20T10:00:00.000Z',
          clock_offset_ms: 0,
          occurred_at: '2026-11-20T10:00:00.000Z',
          business_date: '2026-11-20',
          invoice_no: 'OUT01-POS01-1126-000001',
          invoice_prefix: 'OUT01-POS01',
          invoice_period: '1126',
          invoice_seq: 1,
          legal_entity_id: le.id,
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
            id: idGen.newId(),
            line_no: 1,
            line_kind: 'ITEM',
            product_id: prodKopi.pId,
            sku_id: prodKopi.sId,
            uom_id: pcsId,
            sku_code: prodKopi.code,
            item_name: prodKopi.name,
            uom_code: 'pcs',
            qty: '1',
            conversion_factor: '1.0000',
            qty_base: '1',
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
            method_id: cashMethodId,
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

    const pushRes = await processPush(
      syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [saleCmd] },
      { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: 'k07-push' },
    )
    expect(pushRes.results[0]!.outcome).toBe('ACK')

    await withTenant(created.tenantId, async (tx) => {
      const flags = await tx.execute<{ flag_code: string }>(
        sql`SELECT flag_code FROM data_flag WHERE tenant_id = ${created.tenantId} AND entity_type = 'SALE_LINE'`,
      )
      expect(flags.rows.some((r) => r.flag_code === 'ITEM_TIDAK_TERSEDIA')).toBe(true)

      // Figur penjualan tidak berubah oleh flag, dan rantai audit tetap utuh.
      const chain = await verifyAuditChain(tx)
      expect(chain.ok).toBe(true)
    })
  })

  it('F3-K08: perintah gagal tercatat di attention_item dengan commandId yang dapat ditelusuri', async () => {
    const slug = uniqueSlug('f3-k08')
    const { created, actor, outlet } = await setupOwnerOutlet(slug, 'PT K08')
    const reg = await createRegister(actor, {
      outletId: outlet.id,
      code: 'POS01',
      name: 'POS 01',
      registerType: 'CASHIER',
      invoicePrefix: 'OUT01-POS01',
    })
    const pairing = await createPairingCode(actor, reg.id)
    const dev = await enrollDevice({ slug, code: pairing.code, device_name: 'POS-K08' }, '10.50.0.2', {
      minDelayMs: 0,
    })

    const syncDevice: SyncDeviceIdentity = {
      tenantId: created.tenantId,
      deviceId: dev.device_id,
      registerId: reg.id,
      outletId: outlet.id,
      registerType: 'CASHIER',
    }

    // Perintah tidak valid secara skema -> ATTENTION (BR-SYN, AP-02).
    const failedCmdId = idGen.newId()
    const invalidCmd: PushCommandEnvelope = {
      id: failedCmdId,
      type: 'FinalizeSale',
      schema_version: 1,
      device_seq: 1,
      depends_on: [],
      created_at_device: '2026-11-20T10:00:00.000Z',
      payload: { invalid: true },
    }

    const pushRes = await processPush(
      syncDevice,
      { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [invalidCmd] },
      { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: 'k08-fail' },
    )
    expect(pushRes.results[0]!.outcome).toBe('ATTENTION')

    await withTenant(created.tenantId, async (tx) => {
      const att = await tx.execute<{ command_id: string }>(
        sql`SELECT command_id FROM attention_item WHERE tenant_id = ${created.tenantId} AND command_id = ${failedCmdId}`,
      )
      expect(att.rows.length).toBe(1)
      expect(att.rows[0]!.command_id).toBe(failedCmdId)
    })
  })

  it('F3-K10: evaluasi rilis membedakan pembaruan lunak, wajib, dan server tertinggal', () => {
    const base = {
      latest: 'v0.3.1',
      min_supported_app_version: 'v0.2.0',
      min_supported_schema_version: 1,
      is_mandatory: false,
      accept_previous_until: null,
      max_schema_version: 1,
    }
    const now = Date.parse('2026-11-20T12:00:00.000Z')

    // Klien di bawah versi minimum -> REQUIRED (pembaruan keras hanya saat shift tertutup, BR-VER-012b).
    expect(
      evaluateRelease(
        { ...base, min_supported_app_version: 'v0.3.0' },
        { appVersion: 'v0.2.0', schemaVersion: 1 },
        now,
      ),
    ).toBe('REQUIRED')

    // Klien tertinggal dari latest tetapi masih di atas minimum -> SOFT.
    expect(evaluateRelease(base, { appVersion: 'v0.3.0', schemaVersion: 1 }, now)).toBe('SOFT')

    // Klien sudah terbaru -> UP_TO_DATE.
    expect(evaluateRelease(base, { appVersion: 'v0.3.1', schemaVersion: 1 }, now)).toBe('UP_TO_DATE')

    // Skema klien lebih baru dari yang dipahami server -> SERVER_BEHIND (outbox ditahan).
    expect(evaluateRelease(base, { appVersion: 'v0.3.1', schemaVersion: 2 }, now)).toBe('SERVER_BEHIND')
  })
})
