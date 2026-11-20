import { createHash, webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { canonicalJson, createIdGenerator, formatInvoiceNo, invoicePeriod, parseQty, toMoney } from '~/lib/kernel'
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
  listRolesWithPermissions,
  revokeDevice,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import {
  acceptManual,
  dismissAttention,
  escalateAttention,
  listAttention,
  processPush,
  type SyncAdminActor,
  type SyncDeviceIdentity,
} from '~/modules/sync/public'
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

const testOp = { platformUserId: idGen.newId(), email: 'op-att@example.test' }

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

async function setupEnv() {
  const slug = uniqueSlug('att')
  const ownerEmail = `owner-${slug}@example.test`
  const created = await createTenant(testOp, {
    name: `Att ${slug}`,
    slug,
    ownerEmail,
    ownerDisplayName: 'Owner',
  })
  const tenantId = created.tenantId
  const meta = await getTenantAuthMetadataBySlug(slug)
  const ownerAppUserId = created.ownerInvite.appUserId
  const ownerActor: IdentityAuthActor = {
    tenantId,
    tenantSlug: slug,
    authOrgId: meta?.authOrgId ?? 'org-att',
    appUserId: ownerAppUserId,
    outletIds: null,
    permissions: new Set(PERMISSION_CODES),
  }
  const syncOwner: SyncAdminActor = {
    tenantId,
    appUserId: ownerAppUserId,
    outletIds: null,
    permissions: new Set(PERMISSION_CODES),
  }

  const le = await createLegalEntity(ownerActor, {
    name: 'PT Att Indonesia',
    npwp: '123456789012345',
    isPkp: true,
  })
  const out1 = await createOutlet(ownerActor, {
    legalEntityId: le.id,
    code: 'OUT1',
    name: 'Outlet Satu',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
    taxProfile: 'NONE',
  })
  const out2 = await createOutlet(ownerActor, {
    legalEntityId: le.id,
    code: 'OUT2',
    name: 'Outlet Dua',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
    taxProfile: 'NONE',
  })
  const reg1 = await createRegister(ownerActor, {
    outletId: out1.id,
    code: 'POS01',
    name: 'Kasir 1',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const roles = await listRolesWithPermissions(ownerActor)
  const managerRole = roles.find((r) => r.code === 'MANAGER')!

  const seeded = await masterTx(tenantId, async (c, v) => {
    const supId = (
      await c.query<{ id: string }>(
        `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, $2, 'Sup') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id
    const catId = (
      await c.query<{ id: string }>(
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Kopi') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id
    const uomId = (
      await c.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'cup', 'Cup') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id
    const prodId = (
      await c.query<{ id: string }>(
        `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id) VALUES ($1, $2, $3, 'ESP1', 'Espresso', $4) RETURNING id`,
        [tenantId, v, catId, uomId],
      )
    ).rows[0]!.id
    const skuId = (
      await c.query<{ id: string }>(
        `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES ($1, $2, $3, 'ESPRESSO-1', true) RETURNING id`,
        [tenantId, v, prodId],
      )
    ).rows[0]!.id
    const cashRow = await c.query<{ id: string }>(
      `SELECT id FROM payment_method WHERE tenant_id = $1 AND code = 'CASH' AND deleted_at IS NULL LIMIT 1`,
      [tenantId],
    )
    const pmCashId =
      cashRow.rows[0]?.id ??
      (
        await c.query<{ id: string }>(
          `INSERT INTO payment_method (tenant_id, version, code, name, kind) VALUES ($1, $2, 'CASH', 'Tunai', 'CASH') RETURNING id`,
          [tenantId, v],
        )
      ).rows[0]!.id
    return { supId, uomId, prodId, skuId, pmCashId }
  })

  const pair = await createPairingCode(ownerActor, reg1.id)
  const enrolled = await enrollDevice(
    { slug, code: pair.code, device_name: 'Tab 1' },
    '10.8.0.1',
    { minDelayMs: 0 },
  )

  const devId: SyncDeviceIdentity = {
    tenantId,
    deviceId: enrolled.device_id,
    registerId: reg1.id,
    outletId: out1.id,
    registerType: 'CASHIER',
  }

  return {
    tenantId,
    meta: meta!,
    ownerActor,
    syncOwner,
    managerRole,
    out1,
    out2,
    reg1,
    pmCashId: seeded.pmCashId,
    supId: seeded.supId,
    prodId: seeded.prodId,
    skuId: seeded.skuId,
    uomId: seeded.uomId,
    devId,
  }
}

describe('admin attention queue (list, acceptManual, dismiss, escalate)', () => {
  it('processes AUTHORIZATION item with revoked device manually, blocks STRUCTURAL acceptManual, and propagates DISMISSED -> UNKNOWN_REFERENCE', async () => {
    const env = await setupEnv()
    const shiftId = idGen.newId()
    const nowIso = '2026-11-20T09:00:00.000Z'

    // Open shift first via push
    await processPush(
      env.devId,
      {
        sent_at_device: nowIso,
        clock_offset_ms: 0,
        commands: [
          {
            id: idGen.newId(),
            type: 'OpenShift',
            schema_version: 1,
            device_seq: 1,
            depends_on: [],
            created_at_device: nowIso,
            payload: {
              shift: {
                id: shiftId,
                created_by: env.ownerActor.appUserId,
                created_at_device: nowIso,
                clock_offset_ms: 0,
                occurred_at: nowIso,
                business_date: '2026-11-20',
                opening_cash: 100_000,
              },
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.0.0', syncProtocol: 1, requestRef: 'req-open' },
      { nowIso: () => nowIso },
    )

    // Build canonical FinalizeSale payload with PII customer_name & customer_phone
    const saleId = idGen.newId()
    const saleCmdId = idGen.newId()
    const invNo = formatInvoiceNo({
      prefix: 'OUT01-POS01',
      kind: 'INVOICE',
      period: invoicePeriod('2026-11-20'),
      seq: 1,
    })
    const calc = calcSale({
      lines: [
        {
          lineNo: 1,
          skuId: env.skuId,
          uomId: env.uomId,
          qty: parseQty('1'),
          unitPrice: toMoney(20_000),
          taxable: false,
        },
      ],
      config: {
        priceTaxMode: 'INCLUSIVE',
        taxProfile: 'NONE',
        taxRate: '0',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: false,
      },
    })

    const salePayload = {
      sale: {
        id: saleId,
        shift_id: shiftId,
        created_by: env.ownerActor.appUserId,
        created_at_device: nowIso,
        clock_offset_ms: 0,
        occurred_at: nowIso,
        business_date: '2026-11-20',
        invoice_no: invNo,
        invoice_prefix: 'OUT01-POS01',
        invoice_period: invoicePeriod('2026-11-20'),
        invoice_seq: 1,
        legal_entity_id: env.out1.legalEntityId,
        legal_entity_npwp: '123456789012345',
        legal_entity_is_pkp: true,
        price_tax_mode: 'INCLUSIVE',
        tax_profile: 'NONE',
        tax_rate: '0',
        tax_rate_id: null,
        service_charge_rate: '0',
        service_charge_taxable: false,
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
        customer_name: 'Budi Secret',
        customer_phone: '081234567890',
        catalog_cursor: null,
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
          uom_id: env.uomId,
          sku_code: 'ESPRESSO-1',
          item_name: 'Espresso',
          uom_code: 'cup',
          qty: '1',
          conversion_factor: '1',
          qty_base: '1',
          unit_price: 20_000,
          price_source: 'OUTLET',
          is_open_price: false,
          taxable: false,
          discount_type: null,
          discount_pct: null,
          discount_input: null,
          discount_approved_by: null,
          line_gross: calc.lines[0]!.lineGross,
          line_discount: calc.lines[0]!.lineDiscount,
          line_net: calc.lines[0]!.lineNet,
          bill_discount_alloc: calc.lines[0]!.billDiscountAlloc,
          service_alloc: calc.lines[0]!.serviceAlloc,
          tax_alloc: calc.lines[0]!.taxAlloc,
          note: null,
          source_bill_item_id: null,
          modifiers: [],
        },
      ],
      payments: [
        {
          id: idGen.newId(),
          seq: 1,
          method_id: env.pmCashId,
          method_code: 'CASH',
          method_name: 'Tunai',
          method_kind: 'CASH',
          amount_applied: 20_000,
          cash_tendered: 20_000,
          change_given: 0,
          reference: null,
          is_rounding_settler: false,
        },
      ],
    }

    // Revoke device and record an AUTHORIZATION attention_item (simulating queued item held on revoked auth)
    await revokeDevice(env.ownerActor, { deviceId: env.devId.deviceId, reasonCode: 'LOST' })

    const authAttentionId = idGen.newId()
    const structAttentionId = idGen.newId()
    const structCmdId = idGen.newId()
    const saleHash = createHash('sha256')
      .update(canonicalJson({ type: 'FinalizeSale', schema_version: 1, payload: salePayload }), 'utf8')
      .digest('hex')

    await withTenant(env.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO idempotency_command (
          command_id, tenant_id, device_id, register_id, outlet_id, command_type,
          channel, schema_version, device_seq, payload_hash, status, result,
          request_ref, app_version
        ) VALUES (
          ${saleCmdId}::uuid, ${env.tenantId}::uuid, ${env.devId.deviceId}::uuid,
          ${env.reg1.id}::uuid, ${env.out1.id}::uuid, 'FinalizeSale',
          'OUTBOX', 1, 2, ${saleHash}, 'ATTENTION', '{}'::jsonb, 'att-auth-1', 'v1.0.0'
        ), (
          ${structCmdId}::uuid, ${env.tenantId}::uuid, ${env.devId.deviceId}::uuid,
          ${env.reg1.id}::uuid, ${env.out1.id}::uuid, 'RecordCashMovement',
          'OUTBOX', 1, 3, ${saleHash}, 'ATTENTION', '{}'::jsonb, 'att-str-1', 'v1.0.0'
        )
      `)
      await tx.execute(sql`
        INSERT INTO attention_item (
          id, tenant_id, outlet_id, register_id, device_id, command_id, command_type,
          reason_class, reason_code, detail, payload, status, request_ref
        ) VALUES (
          ${authAttentionId}::uuid, ${env.tenantId}::uuid, ${env.out1.id}::uuid,
          ${env.reg1.id}::uuid, ${env.devId.deviceId}::uuid, ${saleCmdId}::uuid,
          'FinalizeSale', 'AUTHORIZATION', 'DEVICE_REVOKED', 'Device lost during sync',
          ${JSON.stringify(salePayload)}::jsonb, 'OPEN', 'att-auth-1'
        ), (
          ${structAttentionId}::uuid, ${env.tenantId}::uuid, ${env.out1.id}::uuid,
          ${env.reg1.id}::uuid, ${env.devId.deviceId}::uuid, ${structCmdId}::uuid,
          'RecordCashMovement', 'STRUCTURAL', 'PAYMENT_MISMATCH', 'Mismatched payload',
          '{"movement":{"id":"01950000-0000-7000-8000-000000000001"}}'::jsonb, 'OPEN', 'att-str-1'
        )
      `)
    })

    // 1. Scoped manager for OUT2 cannot see OUT1 items; OUT1 manager sees sanitized summary without customer PII
    const out2Mgr: SyncAdminActor = {
      tenantId: env.tenantId,
      appUserId: idGen.newId(),
      outletIds: [env.out2.id],
      permissions: ['user.manage'],
    }
    expect(await listAttention(out2Mgr)).toHaveLength(0)

    const listed = await listAttention(env.syncOwner)
    expect(listed).toHaveLength(2)
    const authItem = listed.find((x) => x.id === authAttentionId)!
    expect(authItem.canAcceptManual).toBe(true)
    expect(authItem.summary.invoiceNo).toBe(invNo)
    expect(JSON.stringify(authItem.summary)).not.toContain('Budi Secret')
    expect(JSON.stringify(authItem.summary)).not.toContain('081234567890')

    // 2. Structural PAYMENT_MISMATCH cannot be manually accepted
    await expect(acceptManual(env.syncOwner, structAttentionId)).rejects.toThrow(/cannot be accepted/)

    // 3. acceptManual processes AUTHORIZATION FinalizeSale under revoked device identity + idempotency
    const acc = await acceptManual(env.syncOwner, authAttentionId)
    expect(acc).toEqual({ id: authAttentionId, status: 'ACCEPTED', replay: false })
    expect(await acceptManual(env.syncOwner, authAttentionId)).toEqual({
      id: authAttentionId,
      status: 'ACCEPTED',
      replay: true,
    })

    // Verify sale row was created on server and dependent VoidSale now succeeds
    const voidRes = await processPush(
      env.devId,
      {
        sent_at_device: '2026-11-20T09:10:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: idGen.newId(),
            type: 'VoidSale',
            schema_version: 1,
            device_seq: 4,
            depends_on: [saleCmdId],
            created_at_device: '2026-11-20T09:10:00.000Z',
            payload: {
              sale_id: saleId,
              voided_at: '2026-11-20T09:10:00.000Z',
              voided_by: env.ownerActor.appUserId,
              void_approved_by: env.supId,
              reason_code: 'MISTAKE',
              reason_text: 'Void after manual accept',
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.0.0', syncProtocol: 1, requestRef: 'req-void' },
      { nowIso: () => '2026-11-20T09:10:00.000Z' },
    )
    expect(voidRes.results[0]!.outcome).toBe('ACK')

    // 4. Escalate & Dismiss structural item (empty reason rejected) -> dependent fails with UNKNOWN_REFERENCE
    await escalateAttention(env.syncOwner, structAttentionId, 'Sent to support')
    await expect(dismissAttention(env.syncOwner, structAttentionId, '   ')).rejects.toThrow()
    await dismissAttention(env.syncOwner, structAttentionId, 'Duplicate corrupt entry')

    const depRes = await processPush(
      env.devId,
      {
        sent_at_device: '2026-11-20T09:12:00.000Z',
        clock_offset_ms: 0,
        commands: [
          {
            id: idGen.newId(),
            type: 'AppendAudit',
            schema_version: 1,
            device_seq: 5,
            depends_on: [structCmdId],
            created_at_device: '2026-11-20T09:12:00.000Z',
            payload: {
              entry: {
                id: idGen.newId(),
                action: 'sale.void',
                entity_type: 'sale',
                entity_id: saleId,
                occurred_at: '2026-11-20T09:12:00.000Z',
              },
            },
          },
        ],
      },
      { schemaVersion: 1, appVersion: 'v1.0.0', syncProtocol: 1, requestRef: 'req-dep-dismissed' },
      { nowIso: () => '2026-11-20T09:12:00.000Z' },
    )
    expect(depRes.results[0]).toMatchObject({
      outcome: 'ATTENTION',
      reason_class: 'STRUCTURAL',
      reason_code: 'UNKNOWN_REFERENCE',
    })
  })
})
