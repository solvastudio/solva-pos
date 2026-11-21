import { webcrypto } from 'node:crypto'
import * as fc from 'fast-check'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  FinalizeSalePayloadV1,
  type PushCommandEnvelope,
  type RecordCashMovementPayloadV1,
  type VoidSalePayloadV1,
} from '~/lib/contracts'
import {
  createIdGenerator,
  formatInvoiceNo,
  invoicePeriod,
  parseQty,
  toMoney,
} from '~/lib/kernel'
import { calcAndSettle } from '~/lib/sales-calc'
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
import { verifyFinalizeSalePayload } from '~/modules/sales/server/sale-verify.adapter'
import { processPush, type SyncDeviceIdentity } from '~/modules/sync/public'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { __resetPushLimitsForTests } from '~/server/auth/rate-limit/push-limits'
import { closePools, withTenant } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { masterTx } from '../integration/helpers/master'
import { uniqueSlug } from '../integration/helpers/tenants'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? (process.env.CI ? 200 : 100))

interface TenantSetupResult {
  tenantId: string
  slug: string
  actor: IdentityAuthActor
  supervisorId: string
  cashierId: string
  leId: string
  outletId: string
  version: number
  pcsId: string
  prodKopi: { pId: string; sId: string; code: string; name: string }
  prodTeh: { pId: string; sId: string; code: string; name: string }
  cashMethodId: string
}

async function setupTestTenant(slug: string): Promise<TenantSetupResult> {
  const testOp = { platformUserId: idGen.newId(), email: `${slug}@example.test` }
  const email = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Conv ${slug}`,
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
  const le = await createLegalEntity(actor, { name: 'PT Conv', isPkp: false })
  const outlet = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })

  // Seed catalog items
  const seeded = await masterTx(created.tenantId, async (c, v) => {
    const catId = (
      await c.query<{ id: string }>(
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Minuman') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id
    const pcsId = (
      await c.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pcs') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id

    const makeProd = async (code: string, name: string) => {
      const pId = (
        await c.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [created.tenantId, v, catId, code, name, pcsId],
        )
      ).rows[0]!.id
      const sId = (
        await c.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default)
           VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [created.tenantId, v, pId, code],
        )
      ).rows[0]!.id
      return { pId, sId, code, name }
    }

    const prodKopi = await makeProd('SKU-KOPI', 'Kopi Hitam')
    const prodTeh = await makeProd('SKU-TEH', 'Teh Tarik')

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

    // Seed supervisor user for approvals
    const supId = idGen.newId()
    await c.query(
      `INSERT INTO app_user (id, tenant_id, display_name, is_active, membership_status, version)
       VALUES ($1, $2, 'Supervisor', true, 'ACTIVE', $3)`,
      [supId, created.tenantId, v],
    )

    return { pcsId, prodKopi, prodTeh, cashMethodId, supId, version: v }
  })

  return {
    tenantId: created.tenantId,
    slug,
    actor,
    supervisorId: seeded.supId,
    cashierId: created.ownerInvite.appUserId,
    leId: le.id,
    outletId: outlet.id,
    version: seeded.version,
    pcsId: seeded.pcsId,
    prodKopi: seeded.prodKopi,
    prodTeh: seeded.prodTeh,
    cashMethodId: seeded.cashMethodId,
  }
}

interface RegisterSetupResult {
  registerId: string
  code: string
  prefix: string
  syncDevice: SyncDeviceIdentity
}

async function setupRegister(
  env: TenantSetupResult,
  code: string,
): Promise<RegisterSetupResult> {
  const prefix = `OUT01-${code}`
  const reg = await createRegister(env.actor, {
    outletId: env.outletId,
    code,
    name: `POS ${code}`,
    registerType: 'CASHIER',
    invoicePrefix: prefix,
  })
  const pairing = await createPairingCode(env.actor, reg.id)
  const dev = await enrollDevice(
    { slug: env.slug, code: pairing.code, device_name: `Dev-${code}` },
    '10.20.0.1',
    { minDelayMs: 0 },
  )
  const syncDevice: SyncDeviceIdentity = {
    tenantId: env.tenantId,
    deviceId: dev.device_id,
    registerId: reg.id,
    outletId: env.outletId,
    registerType: 'CASHIER',
  }
  return { registerId: reg.id, code, prefix, syncDevice }
}

function makeSaleCommand(
  env: TenantSetupResult,
  reg: RegisterSetupResult,
  opts: {
    shiftId: string
    deviceSeq: number
    invoiceSeq: number
    kopiQty: number
    tehQty: number
  },
): PushCommandEnvelope {
  const bd = '2026-11-20'
  const period = invoicePeriod(bd)
  const linesInput = [
    {
      lineNo: 1,
      skuId: env.prodKopi.sId,
      uomId: env.pcsId,
      qty: parseQty(String(opts.kopiQty)),
      unitPrice: toMoney(18500),
      taxable: true,
    },
    {
      lineNo: 2,
      skuId: env.prodTeh.sId,
      uomId: env.pcsId,
      qty: parseQty(String(opts.tehQty)),
      unitPrice: toMoney(12000),
      taxable: true,
    },
  ]

  const { calc, settlement } = calcAndSettle(
    {
      lines: linesInput,
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11.0000',
        serviceChargeEnabled: false,
        serviceChargeRate: '0.0000',
        serviceChargeTaxable: true,
      },
    },
    [
      {
        methodCode: 'CASH',
        kind: 'CASH',
        amount: toMoney(1000000),
      },
    ],
    100,
  )

  const saleId = idGen.newId()
  const payload: FinalizeSalePayloadV1 = {
    sale: {
      id: saleId,
      shift_id: opts.shiftId,
      created_by: env.cashierId,
      created_at_device: '2026-11-20T10:00:00.000Z',
      clock_offset_ms: 0,
      occurred_at: '2026-11-20T10:00:00.000Z',
      business_date: bd,
      invoice_no: formatInvoiceNo({ prefix: reg.prefix, kind: 'INVOICE', period, seq: opts.invoiceSeq }),
      invoice_prefix: reg.prefix,
      invoice_period: period,
      invoice_seq: opts.invoiceSeq,
      legal_entity_id: env.leId,
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
    lines: [
      {
        id: idGen.newId(),
        line_no: 1,
        line_kind: 'ITEM',
        product_id: env.prodKopi.pId,
        sku_id: env.prodKopi.sId,
        uom_id: env.pcsId,
        sku_code: env.prodKopi.code,
        item_name: env.prodKopi.name,
        uom_code: 'pcs',
        qty: String(opts.kopiQty),
        conversion_factor: '1.0000',
        qty_base: String(opts.kopiQty),
        unit_price: 18500,
        price_source: 'OUTLET',
        is_open_price: false,
        taxable: true,
        discount_type: null,
        discount_pct: null,
        discount_input: null,
        discount_approved_by: null,
        line_gross: calc.lines[0]!.lineGross,
        line_discount: 0,
        line_net: calc.lines[0]!.lineNet,
        bill_discount_alloc: 0,
        service_alloc: 0,
        tax_alloc: calc.lines[0]!.taxAlloc,
        note: null,
        source_bill_item_id: null,
        modifiers: [],
      },
      {
        id: idGen.newId(),
        line_no: 2,
        line_kind: 'ITEM',
        product_id: env.prodTeh.pId,
        sku_id: env.prodTeh.sId,
        uom_id: env.pcsId,
        sku_code: env.prodTeh.code,
        item_name: env.prodTeh.name,
        uom_code: 'pcs',
        qty: String(opts.tehQty),
        conversion_factor: '1.0000',
        qty_base: String(opts.tehQty),
        unit_price: 12000,
        price_source: 'OUTLET',
        is_open_price: false,
        taxable: true,
        discount_type: null,
        discount_pct: null,
        discount_input: null,
        discount_approved_by: null,
        line_gross: calc.lines[1]!.lineGross,
        line_discount: 0,
        line_net: calc.lines[1]!.lineNet,
        bill_discount_alloc: 0,
        service_alloc: 0,
        tax_alloc: calc.lines[1]!.taxAlloc,
        note: null,
        source_bill_item_id: null,
        modifiers: [],
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
        amount_applied: settlement.totalDue,
        cash_tendered: 1000000,
        change_given: settlement.changeTotal,
        reference: null,
        is_rounding_settler: true,
      },
    ],
  }

  // Verify schema and numerical consistency
  FinalizeSalePayloadV1.parse(payload)
  const verified = verifyFinalizeSalePayload(payload)
  expect(verified.ok).toBe(true)

  return {
    id: saleId,
    type: 'FinalizeSale',
    schema_version: 1,
    device_seq: opts.deviceSeq,
    depends_on: [],
    created_at_device: '2026-11-20T10:00:00.000Z',
    payload,
  }
}

function makeCashMovementCommand(
  env: TenantSetupResult,
  opts: {
    shiftId: string
    deviceSeq: number
    direction: 'IN' | 'OUT'
    amount: number
  },
): PushCommandEnvelope {
  const movId = idGen.newId()
  const payload: RecordCashMovementPayloadV1 = {
    movement: {
      id: movId,
      shift_id: opts.shiftId,
      created_by: env.cashierId,
      created_at_device: '2026-11-20T10:05:00.000Z',
      clock_offset_ms: 0,
      occurred_at: '2026-11-20T10:05:00.000Z',
      business_date: '2026-11-20',
      direction: opts.direction,
      amount: opts.amount,
      reason_code: 'PETTY_CASH',
      reason_text: 'Top up or withdrawal',
    },
  }

  return {
    id: movId,
    type: 'RecordCashMovement',
    schema_version: 1,
    device_seq: opts.deviceSeq,
    depends_on: [],
    created_at_device: '2026-11-20T10:05:00.000Z',
    payload,
  }
}

function makeVoidCommand(
  env: TenantSetupResult,
  saleCmd: PushCommandEnvelope,
  opts: { deviceSeq: number },
): PushCommandEnvelope {
  const voidId = idGen.newId()
  const payload: VoidSalePayloadV1 = {
    sale_id: saleCmd.id,
    voided_at: '2026-11-20T10:10:00.000Z',
    voided_by: env.cashierId,
    void_approved_by: env.supervisorId,
    reason_code: 'WRONG_ITEM',
    reason_text: 'Customer changed mind',
  }

  return {
    id: voidId,
    type: 'VoidSale',
    schema_version: 1,
    device_seq: opts.deviceSeq,
    depends_on: [saleCmd.id],
    created_at_device: '2026-11-20T10:10:00.000Z',
    payload,
  }
}

describe('Sync convergence & idempotency property suite (K03, FR-QA-001..003)', () => {
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

  describe('Idempotency property (Level A)', () => {
    it('guarantees identical terminal DB state and ACK outcomes when commands are replayed 1 to 3 times', async () => {
      const slug = uniqueSlug('prop-idemp')
      const env = await setupTestTenant(slug)
      const reg = await setupRegister(env, 'POS01')

      // Pre-open a shift
      const shiftId = idGen.newId()
      const openShiftCmd: PushCommandEnvelope = {
        id: shiftId,
        type: 'OpenShift',
        schema_version: 1,
        device_seq: 1,
        depends_on: [],
        created_at_device: '2026-11-20T08:00:00.000Z',
        payload: {
          shift: {
            id: shiftId,
            created_by: env.cashierId,
            created_at_device: '2026-11-20T08:00:00.000Z',
            clock_offset_ms: 0,
            occurred_at: '2026-11-20T08:00:00.000Z',
            business_date: '2026-11-20',
            opening_cash: 500000,
          },
        },
      }
      await processPush(
        reg.syncDevice,
        { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [openShiftCmd] },
        { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: 'open-shift' },
      )

      let runIteration = 0
      let nextSeq = 2
      let nextInvoiceSeq = 1

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 3 }), // Number of sales in this cycle
          fc.boolean(), // Whether to include a cash movement
          fc.boolean(), // Whether to void the last sale
          async (numSales, hasCashMovement, shouldVoid) => {
            runIteration += 1
            const batchCommands: PushCommandEnvelope[] = []
            let lastSale: PushCommandEnvelope | null = null

            for (let i = 0; i < numSales; i += 1) {
              const sale = makeSaleCommand(env, reg, {
                shiftId,
                deviceSeq: nextSeq++,
                invoiceSeq: nextInvoiceSeq++,
                kopiQty: 1 + (i % 2),
                tehQty: 1 + (i % 3),
              })
              batchCommands.push(sale)
              lastSale = sale
            }

            if (hasCashMovement) {
              const mov = makeCashMovementCommand(env, {
                shiftId,
                deviceSeq: nextSeq++,
                direction: runIteration % 2 === 0 ? 'IN' : 'OUT',
                amount: 50000,
              })
              batchCommands.push(mov)
            }

            if (shouldVoid && lastSale) {
              const voidCmd = makeVoidCommand(env, lastSale, {
                deviceSeq: nextSeq++,
              })
              batchCommands.push(voidCmd)
            }

            // 1. First execution: push all commands
            const push1 = await processPush(
              reg.syncDevice,
              { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: batchCommands },
              { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: `r${runIteration}-p1` },
            )
            for (const item of push1.results) {
              expect(item.outcome).toBe('ACK')
            }

            // Snapshot DB state
            const snapshot1 = await withTenant(env.tenantId, async (tx) => {
              const saleRes = await tx.execute<{ count: string; grand_total: string }>(
                sql`SELECT count(*)::text AS count, coalesce(sum(grand_total), 0)::text AS grand_total FROM sale WHERE tenant_id = ${env.tenantId}`,
              )
              const idempRes = await tx.execute<{ count: string }>(
                sql`SELECT count(*)::text AS count FROM idempotency_command WHERE tenant_id = ${env.tenantId}`,
              )
              const auditOk = await verifyAuditChain(tx)
              expect(auditOk.ok).toBe(true)
              return {
                saleCount: (saleRes.rows[0] as { count: string }).count,
                saleTotal: (saleRes.rows[0] as { grand_total: string }).grand_total,
                idempCount: (idempRes.rows[0] as { count: string }).count,
              }
            })

            // 2. Replay all commands again (idempotent replay)
            const push2 = await processPush(
              reg.syncDevice,
              { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: batchCommands },
              { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: `r${runIteration}-p2` },
            )
            for (const item of push2.results) {
              expect(item.outcome).toBe('ACK')
            }

            // Verify DB state is identical
            await withTenant(env.tenantId, async (tx) => {
              const saleRes2 = await tx.execute<{ count: string; grand_total: string }>(
                sql`SELECT count(*)::text AS count, coalesce(sum(grand_total), 0)::text AS grand_total FROM sale WHERE tenant_id = ${env.tenantId}`,
              )
              const idempRes2 = await tx.execute<{ count: string }>(
                sql`SELECT count(*)::text AS count FROM idempotency_command WHERE tenant_id = ${env.tenantId}`,
              )
              expect((saleRes2.rows[0] as { count: string }).count).toBe(snapshot1.saleCount)
              expect((saleRes2.rows[0] as { grand_total: string }).grand_total).toBe(snapshot1.saleTotal)
              expect((idempRes2.rows[0] as { count: string }).count).toBe(snapshot1.idempCount)
            })
          },
        ),
        { numRuns: Math.min(NUM_RUNS, 20) },
      )
    })
  })

  describe('Multi-register convergence property (Level B)', () => {
    it('converges to identical DB totals regardless of arrival interleaving across registers', async () => {
      const slug = uniqueSlug('prop-conv')
      const env = await setupTestTenant(slug)
      const reg1 = await setupRegister(env, 'POS01')
      const reg2 = await setupRegister(env, 'POS02')

      // Open shift for both
      const shift1Id = idGen.newId()
      const shift2Id = idGen.newId()

      await processPush(
        reg1.syncDevice,
        {
          sent_at_device: new Date().toISOString(),
          clock_offset_ms: 0,
          commands: [
            {
              id: shift1Id,
              type: 'OpenShift',
              schema_version: 1,
              device_seq: 1,
              depends_on: [],
              created_at_device: '2026-11-20T08:00:00.000Z',
              payload: {
                shift: {
                  id: shift1Id,
                  created_by: env.cashierId,
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
        { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: 'open-sh1' },
      )

      await processPush(
        reg2.syncDevice,
        {
          sent_at_device: new Date().toISOString(),
          clock_offset_ms: 0,
          commands: [
            {
              id: shift2Id,
              type: 'OpenShift',
              schema_version: 1,
              device_seq: 1,
              depends_on: [],
              created_at_device: '2026-11-20T08:00:00.000Z',
              payload: {
                shift: {
                  id: shift2Id,
                  created_by: env.cashierId,
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
        { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: 'open-sh2' },
      )

      // Generate commands for Reg1 and Reg2
      const reg1Cmds = [
        makeSaleCommand(env, reg1, { shiftId: shift1Id, deviceSeq: 2, invoiceSeq: 1, kopiQty: 2, tehQty: 1 }),
        makeSaleCommand(env, reg1, { shiftId: shift1Id, deviceSeq: 3, invoiceSeq: 2, kopiQty: 1, tehQty: 3 }),
        makeCashMovementCommand(env, { shiftId: shift1Id, deviceSeq: 4, direction: 'IN', amount: 50000 }),
      ]

      const reg2Cmds = [
        makeSaleCommand(env, reg2, { shiftId: shift2Id, deviceSeq: 2, invoiceSeq: 1, kopiQty: 3, tehQty: 2 }),
        makeSaleCommand(env, reg2, { shiftId: shift2Id, deviceSeq: 3, invoiceSeq: 2, kopiQty: 1, tehQty: 1 }),
        makeCashMovementCommand(env, { shiftId: shift2Id, deviceSeq: 4, direction: 'OUT', amount: 25000 }),
      ]

      // Push interleaved: reg1[0], reg2[0], reg1[1], reg2[1], reg1[2], reg2[2]
      for (let i = 0; i < 3; i += 1) {
        const r1 = await processPush(
          reg1.syncDevice,
          { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [reg1Cmds[i]!] },
          { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: `il-r1-${i}` },
        )
        expect(r1.results[0]!.outcome).toBe('ACK')

        const r2 = await processPush(
          reg2.syncDevice,
          { sent_at_device: new Date().toISOString(), clock_offset_ms: 0, commands: [reg2Cmds[i]!] },
          { schemaVersion: 1, appVersion: 'v0.3.0', syncProtocol: 1, requestRef: `il-r2-${i}` },
        )
        expect(r2.results[0]!.outcome).toBe('ACK')
      }

      // Verify all sales and cash movements committed cleanly
      await withTenant(env.tenantId, async (tx) => {
        const saleCount = await tx.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM sale WHERE tenant_id = ${env.tenantId}`)
        expect((saleCount.rows[0] as { count: string }).count).toBe('4')

        const movCount = await tx.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM cash_movement WHERE tenant_id = ${env.tenantId}`)
        expect((movCount.rows[0] as { count: string }).count).toBe('2')

        const chain = await verifyAuditChain(tx)
        expect(chain.ok).toBe(true)
      })
    })
  })
})
