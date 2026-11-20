import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator, formatInvoiceNo, parseQty, toMoney } from '~/lib/kernel'
import { calcSale } from '~/lib/sales-calc'
import { verifyAuditChain } from '~/modules/audit/public'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  authenticateDevice,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  getTenantAuthMetadataBySlug,
  listDevices,
  redeemInvite,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import {
  annotateGap,
  listGaps,
  previewRegisterRecovery,
  recoverRegister,
} from '~/modules/sales/public'
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

const testOp = { platformUserId: idGen.newId(), email: 'op-rec@example.test' }
const RECOVERY_NOW = () => '2026-11-20T10:00:00.000Z'

async function setupRecoveryEnv(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Rec ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Rec', isPkp: false })
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
    code: 'POS02',
    name: 'POS 2',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS02',
  })
  const p = await createPairingCode(actor, reg.id)
  const dev = await enrollDevice({ slug, code: p.code, device_name: 'OldPOS' }, '10.10.0.1', {
    minDelayMs: 0,
  })

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
    return { pcsId, prodId, skuId, cashMethodId, version: v }
  })

  const syncDevice: SyncDeviceIdentity = {
    tenantId: created.tenantId,
    deviceId: dev.device_id,
    registerId: reg.id,
    outletId: outlet.id,
    registerType: 'CASHIER',
  }

  return { tenantId: created.tenantId, slug, actor, le, outlet, reg, dev, syncDevice, ...seeded }
}

describe('Register recovery & gap annotation integration (BR-INV-007/008, V-29)', () => {
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

  it('implements BR-INV-008 recovery (124 -> declared 127 => next 128 + gap [125,127]), enrolls replacement counter, revokes old device, and annotates gaps with RLS isolation', async () => {
    const env = await setupRecoveryEnv(uniqueSlug('rec-a'))
    const envB = await setupRecoveryEnv(uniqueSlug('rec-b'))

    // Push shift + sale at seq 124 (period 1126 -> invoice_series.max_seq_received = 124)
    const shiftId = idGen.newId()
    const saleId = idGen.newId()
    const calc = calcSale({
      lines: [
        { lineNo: 1, skuId: env.skuId, uomId: env.pcsId, qty: parseQty('1'), unitPrice: toMoney(15_000), taxable: false },
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
    const line = calc.lines[0]!
    const pushRes = await processPush(
      env.syncDevice,
      {
        sent_at_device: '2026-11-20T09:00:00.000Z',
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
          {
            id: saleId,
            type: 'FinalizeSale',
            schema_version: 1,
            device_seq: 2,
            depends_on: [shiftId],
            created_at_device: '2026-11-20T09:00:00.000Z',
            payload: {
              sale: {
                id: saleId,
                shift_id: shiftId,
                created_by: env.actor.appUserId,
                created_at_device: '2026-11-20T09:00:00.000Z',
                clock_offset_ms: 0,
                occurred_at: '2026-11-20T09:00:00.000Z',
                business_date: '2026-11-20',
                invoice_no: formatInvoiceNo({
                  prefix: 'OUT01-POS02',
                  kind: 'INVOICE',
                  period: '1126',
                  seq: 124,
                }),
                invoice_prefix: 'OUT01-POS02',
                invoice_period: '1126',
                invoice_seq: 124,
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
                  unit_price: 15_000,
                  price_source: 'OUTLET',
                  is_open_price: false,
                  taxable: false,
                  discount_type: null,
                  discount_pct: null,
                  discount_input: null,
                  discount_approved_by: null,
                  line_gross: line.lineGross,
                  line_discount: 0,
                  line_net: line.lineNet,
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
                  amount_applied: 15_000,
                  cash_tendered: 15_000,
                  change_given: 0,
                  reference: null,
                  is_rounding_settler: false,
                },
              ],
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v0.1.0', syncProtocol: 1, requestRef: 'rec-sale-124' },
    )
    expect(pushRes.results.map((r) => r.outcome)).toEqual(['ACK', 'ACK'])

    // Preview without declaration -> nextSeq = 125, gapRange = null
    const prevNoDecl = await previewRegisterRecovery(
      env.actor,
      { registerId: env.reg.id, declaredLastInvoiceSeq: null },
      { nowIso: RECOVERY_NOW },
    )
    expect(prevNoDecl.period).toBe('1126')
    expect(prevNoDecl.invoice.highestReceivedSeq).toBe(124)
    expect(prevNoDecl.invoice.nextSeq).toBe(125)
    expect(prevNoDecl.invoice.gapRange).toBeNull()

    // Declared < highest -> VALIDATION_FAILED
    await expect(
      previewRegisterRecovery(
        env.actor,
        { registerId: env.reg.id, declaredLastInvoiceSeq: 120 },
        { nowIso: RECOVERY_NOW },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(
      recoverRegister(
        env.actor,
        { registerId: env.reg.id, reasonCode: 'LOST', declaredLastInvoiceSeq: 120 },
        { nowIso: RECOVERY_NOW },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    // Preview with BR-INV-008 declared = 127 -> next = 128, gap [125, 127]
    const prevWithDecl = await previewRegisterRecovery(
      env.actor,
      { registerId: env.reg.id, declaredLastInvoiceSeq: 127 },
      { nowIso: RECOVERY_NOW },
    )
    expect(prevWithDecl.invoice.nextSeq).toBe(128)
    expect(prevWithDecl.invoice.nextFormattedNo).toBe('OUT01-POS02-1126-000128')
    expect(prevWithDecl.invoice.gapRange).toEqual({ seqFrom: 125, seqTo: 127 })

    // Execute recovery with declared = 127
    const recRes = await recoverRegister(
      env.actor,
      {
        registerId: env.reg.id,
        reasonCode: 'LOST',
        declaredLastInvoiceSeq: 127,
        reasonText: 'Tablet dropped',
      },
      { nowIso: RECOVERY_NOW },
    )
    expect(recRes.revokedDeviceId).toBe(env.dev.device_id)
    expect(recRes.counters).toEqual([
      { doc_type: 'INVOICE', period: '1126', next_seq: 128 },
      { doc_type: 'CREDIT_NOTE', period: '1126', next_seq: 1 },
    ])
    expect(recRes.createdGaps).toEqual([{ docType: 'INVOICE', seqFrom: 125, seqTo: 127 }])

    // Old device is immediately revoked -> DEVICE_REVOKED when authenticating
    const devicesAfter = await listDevices(env.actor)
    const oldDevRow = devicesAfter.find((d) => d.id === env.dev.device_id)
    expect(oldDevRow?.revokedAt).not.toBeNull()
    await expect(
      authenticateDevice(
        new Request('http://localhost/api/pos/v1/push', {
          headers: { Authorization: `Bearer ${env.dev.credential}` },
        }),
      ),
    ).rejects.toMatchObject({ code: 'DEVICE_REVOKED' })

    // Enroll replacement device -> receives invoice_counters & binds register_recovery.new_device_id
    const pNew = await createPairingCode(env.actor, env.reg.id)
    const newDev = await enrollDevice(
      { slug: env.slug, code: pNew.code, device_name: 'ReplacementPOS' },
      '10.10.0.2',
      { minDelayMs: 0 },
    )
    expect(newDev.invoice_counters).toEqual(
      expect.arrayContaining([
        { doc_type: 'INVOICE', period: '1126', next_seq: 128 },
        { doc_type: 'CREDIT_NOTE', period: '1126', next_seq: 1 },
      ]),
    )

    // Verify gap list, annotation OPEN -> EXPLAINED, audit chain, and Tenant B RLS isolation
    const gaps = await listGaps(env.actor, { status: 'OPEN' })
    const declaredGap = gaps.find((g) => g.seqFrom === 125 && g.seqTo === 127)
    expect(declaredGap).toBeDefined()
    expect(declaredGap!.origin).toBe('RECOVERY_DECLARED')

    // Tenant B cannot see or annotate Tenant A's gaps
    const bGaps = await listGaps(envB.actor)
    expect(bGaps.some((g) => g.id === declaredGap!.id)).toBe(false)
    await expect(
      annotateGap(envB.actor, declaredGap!.id, { reasonText: 'Cross-tenant hijack' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    const annotated = await annotateGap(
      env.actor,
      declaredGap!.id,
      { reasonCode: 'HARDWARE_LOSS', reasonText: 'Receipt paper burnt; last paper receipt #127' },
      { nowIso: () => '2026-11-20T11:00:00.000Z' },
    )
    expect(annotated).toEqual({ id: declaredGap!.id, status: 'EXPLAINED' })

    await withTenant(env.tenantId, async (tx) => {
      const recRows = await tx.execute<{ new_device_id: string | null }>(
        `SELECT new_device_id FROM register_recovery WHERE register_id = '${env.reg.id}'`,
      )
      expect(recRows.rows.every((r) => r.new_device_id === newDev.device_id)).toBe(true)

      const chain = await verifyAuditChain(tx)
      expect(chain.ok).toBe(true)
    })
  })

  it('recovers without declared sequence (next_seq = highest + 1, no RECOVERY_DECLARED gap)', async () => {
    const env = await setupRecoveryEnv(uniqueSlug('rec-nodecl'))
    const res = await recoverRegister(
      env.actor,
      {
        registerId: env.reg.id,
        reasonCode: 'REPLACED',
        declaredLastInvoiceSeq: null,
        declaredLastCreditSeq: null,
      },
      { nowIso: RECOVERY_NOW },
    )
    expect(res.counters).toEqual([
      { doc_type: 'INVOICE', period: '1126', next_seq: 1 },
      { doc_type: 'CREDIT_NOTE', period: '1126', next_seq: 1 },
    ])
    expect(res.createdGaps).toEqual([])
    const gaps = await listGaps(env.actor)
    expect(gaps).toHaveLength(0)
  })
})
