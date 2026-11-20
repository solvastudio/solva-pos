import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createIdGenerator } from '~/lib/kernel'
import {
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  enrollDevice,
  savePaymentMethod,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import type { ReportActorContext } from '~/modules/reporting/public'
import { withTenant, type TenantTx } from '~/server/db'
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

export function newTestUuid(): string {
  return idGen.newId()
}

export async function insertStubCommand(
  tx: TenantTx,
  opts: {
    tenantId: string
    outletId: string
    registerId: string
    deviceId: string
    commandType:
      | 'OpenShift'
      | 'CloseShift'
      | 'RecordCashMovement'
      | 'FinalizeSale'
      | 'VoidSale'
      | 'FinalizeCreditNote'
  },
): Promise<string> {
  const commandId = idGen.newId()
  await tx.execute(sql`
    INSERT INTO idempotency_command (
      command_id, tenant_id, device_id, register_id, outlet_id,
      command_type, channel, schema_version, payload_hash, status, result
    ) VALUES (
      ${commandId}::uuid,
      ${opts.tenantId}::uuid,
      ${opts.deviceId}::uuid,
      ${opts.registerId}::uuid,
      ${opts.outletId}::uuid,
      ${opts.commandType},
      'ONLINE',
      1,
      ${'a'.repeat(64)},
      'ACKED',
      '{}'::jsonb
    )
  `)
  return commandId
}

export async function seedV25SalesReportFixture() {
  const slug = uniqueSlug('rpt-v25')
  const testOp = { platformUserId: idGen.newId(), email: `op-${slug}@example.test` }
  const created = await createTenant(testOp, {
    name: `Tenant ${slug}`,
    slug,
    ownerEmail: `owner-${slug}@example.test`,
    ownerDisplayName: 'Budi Owner',
  })

  const tenantId = created.tenantId
  const ownerId = created.ownerInvite.appUserId
  const cashierId = idGen.newId()
  const cashier2Id = idGen.newId()

  const ownerIdentity: IdentityAuthActor = {
    tenantId,
    tenantSlug: slug,
    authOrgId: `org-${slug}`,
    appUserId: ownerId,
    outletIds: null,
    permissions: new Set(PERMISSION_CODES),
  }

  // Insert cashier users and default catalog item into master tables
  const catalogRefs = await masterTx(tenantId, async (c, v) => {
    await c.query(
      `INSERT INTO app_user (id, tenant_id, display_name, is_active, membership_status, version)
       VALUES ($1, $2, 'Dewi Kasir', true, 'PENDING', $3), ($4, $2, 'Andi Kasir', true, 'PENDING', $3)`,
      [cashierId, tenantId, v, cashier2Id],
    )
    const catId = (
      await c.query<{ id: string }>(
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Umum') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id
    const uomId = (
      await c.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pieces') RETURNING id`,
        [tenantId, v],
      )
    ).rows[0]!.id
    const prodId = (
      await c.query<{ id: string }>(
        `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id) VALUES ($1, $2, $3, 'PRD1', 'Produk Uji', $4) RETURNING id`,
        [tenantId, v, catId, uomId],
      )
    ).rows[0]!.id
    const skuId = (
      await c.query<{ id: string }>(
        `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES ($1, $2, $3, 'SKU-UJI-1', true) RETURNING id`,
        [tenantId, v, prodId],
      )
    ).rows[0]!.id
    return { catId, uomId, prodId, skuId }
  })

  const le = await createLegalEntity(ownerIdentity, {
    name: 'PT Solva Retail',
    npwp: '123456789012345',
    isPkp: true,
  })

  const out1 = await createOutlet(ownerIdentity, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet Utama',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
    taxProfile: 'PPN',
  })

  const out2 = await createOutlet(ownerIdentity, {
    legalEntityId: le.id,
    code: 'OUT02',
    name: 'Outlet Cabang',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
    taxProfile: 'PPN',
  })

  const reg1 = await createRegister(ownerIdentity, {
    outletId: out1.id,
    code: 'POS01',
    name: 'Kasir 1',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
    paperWidthMm: 80,
  })

  const reg2 = await createRegister(ownerIdentity, {
    outletId: out1.id,
    code: 'POS02',
    name: 'Kasir 2',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS02',
    paperWidthMm: 80,
  })

  const regOut2 = await createRegister(ownerIdentity, {
    outletId: out2.id,
    code: 'POS01',
    name: 'Kasir Cabang 1',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT02-POS01',
    paperWidthMm: 80,
  })

  const pair1 = await createPairingCode(ownerIdentity, reg1.id)
  const dev1Res = await enrollDevice(
    { slug, code: pair1.code, device_name: 'Terminal OUT01-POS01' },
    '10.9.0.1',
    { minDelayMs: 0 },
  )
  const dev1 = { deviceId: dev1Res.device_id }

  const pair2 = await createPairingCode(ownerIdentity, reg2.id)
  const dev2Res = await enrollDevice(
    { slug, code: pair2.code, device_name: 'Terminal OUT01-POS02' },
    '10.9.0.2',
    { minDelayMs: 0 },
  )
  const dev2 = { deviceId: dev2Res.device_id }

  const pairOut2 = await createPairingCode(ownerIdentity, regOut2.id)
  const devOut2Res = await enrollDevice(
    { slug, code: pairOut2.code, device_name: 'Terminal OUT02-POS01' },
    '10.9.0.3',
    { minDelayMs: 0 },
  )
  const devOut2 = { deviceId: devOut2Res.device_id }

  const qrisMethod = await savePaymentMethod(ownerIdentity, {
    code: 'QRIS',
    name: 'QRIS',
    kind: 'NON_CASH',
    requiresReference: true,
    sortOrder: 10,
    isActive: true,
  })

  const transferMethod = await savePaymentMethod(ownerIdentity, {
    code: 'TRANSFER',
    name: 'Transfer',
    kind: 'NON_CASH',
    requiresReference: true,
    sortOrder: 20,
    isActive: true,
  })

  const shiftId = idGen.newId()
  const sale123Id = idGen.newId()
  const sale124Id = idGen.newId()
  const sale125Id = idGen.newId()
  const sale126VoidId = idGen.newId()
  const cn1Id = idGen.newId()

  await withTenant(tenantId, async (tx) => {
    const cashRow = await tx.execute(
      sql`SELECT id FROM payment_method WHERE tenant_id = ${tenantId}::uuid AND code = 'CASH' LIMIT 1`,
    )
    const cashMethodId = (cashRow.rows[0] as { id: string }).id

    const shiftCmdId = await insertStubCommand(tx, {
      tenantId,
      outletId: out1.id,
      registerId: reg1.id,
      deviceId: dev1.deviceId,
      commandType: 'OpenShift',
    })
    const sale123CmdId = await insertStubCommand(tx, {
      tenantId,
      outletId: out1.id,
      registerId: reg1.id,
      deviceId: dev1.deviceId,
      commandType: 'FinalizeSale',
    })
    const sale124CmdId = await insertStubCommand(tx, {
      tenantId,
      outletId: out1.id,
      registerId: reg1.id,
      deviceId: dev1.deviceId,
      commandType: 'FinalizeSale',
    })
    const sale125CmdId = await insertStubCommand(tx, {
      tenantId,
      outletId: out1.id,
      registerId: reg1.id,
      deviceId: dev1.deviceId,
      commandType: 'FinalizeSale',
    })
    const sale126CmdId = await insertStubCommand(tx, {
      tenantId,
      outletId: out1.id,
      registerId: reg1.id,
      deviceId: dev1.deviceId,
      commandType: 'FinalizeSale',
    })
    const void126CmdId = await insertStubCommand(tx, {
      tenantId,
      outletId: out1.id,
      registerId: reg1.id,
      deviceId: dev1.deviceId,
      commandType: 'VoidSale',
    })
    const cn1CmdId = await insertStubCommand(tx, {
      tenantId,
      outletId: out1.id,
      registerId: reg1.id,
      deviceId: dev1.deviceId,
      commandType: 'FinalizeCreditNote',
    })

    // Shift on OUT01-POS01 for 2026-11-17
    await tx.execute(sql`
      INSERT INTO cash_cashier (
        id, tenant_id, outlet_id, register_id, device_id, created_by,
        created_at_device, clock_offset_ms, occurred_at, business_date,
        command_id, schema_version, app_version, status, opening_cash, recap_status
      ) VALUES (
        ${shiftId}::uuid, ${tenantId}::uuid, ${out1.id}::uuid, ${reg1.id}::uuid, ${dev1.deviceId}::uuid, ${cashierId}::uuid,
        '2026-11-17T08:00:00.000Z', 0, '2026-11-17T08:00:00.000Z', '2026-11-17',
        ${shiftCmdId}::uuid, 1, 'v1.0.0', 'OPEN', 500000, 'INCOMPLETE'
      )
    `)

    // Invoice 000123: gross 106.700; discount 5.370; S2 101.330; tax 11.146; rounding +24; total 112.500 (CASH)
    await tx.execute(sql`
      INSERT INTO sale (
        id, tenant_id, outlet_id, register_id, device_id, created_by,
        created_at_device, clock_offset_ms, occurred_at, business_date,
        command_id, schema_version, app_version,
        invoice_no, invoice_prefix, invoice_period, invoice_seq, invoice_conflict_idx,
        shift_id, legal_entity_id, status,
        price_tax_mode, tax_profile, tax_rate, service_charge_rate, service_charge_taxable,
        cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
        gross_total, line_discount_total, bill_discount_total, net_subtotal,
        service_charge, tax_base, tax_amount, dpp, grand_total, rounding,
        customer_phone
      ) VALUES (
        ${sale123Id}::uuid, ${tenantId}::uuid, ${out1.id}::uuid, ${reg1.id}::uuid, ${dev1.deviceId}::uuid, ${cashierId}::uuid,
        '2026-11-17T09:00:00.000Z', 0, '2026-11-17T09:00:00.000Z', '2026-11-17',
        ${sale123CmdId}::uuid, 1, 'v1.0.0',
        'OUT01-POS01-1126-000123', 'OUT01-POS01', '1126', 123, 0,
        ${shiftId}::uuid, ${le.id}::uuid, 'PAID',
        'EXCLUSIVE', 'PPN', '11.0000', '0.0000', false,
        100, 'id-ID', true,
        106700, 5370, 0, 101330,
        0, 101330, 11146, 101330, 112476, 24,
        '08123456789'
      )
    `)

    await tx.execute(sql`
      INSERT INTO sale_payment (
        id, tenant_id, sale_id, shift_id, outlet_id, business_date, seq,
        method_id, method_code, method_name, method_kind,
        amount_applied, cash_tendered, change_given, is_rounding_settler
      ) VALUES (
        ${idGen.newId()}::uuid, ${tenantId}::uuid, ${sale123Id}::uuid, ${shiftId}::uuid, ${out1.id}::uuid, '2026-11-17', 1,
        ${cashMethodId}::uuid, 'CASH', 'Tunai', 'CASH',
        112500, 120000, 7500, true
      )
    `)

    // Invoice 000124: gross 50.000; tax 5.500; total 55.500 (QRIS)
    await tx.execute(sql`
      INSERT INTO sale (
        id, tenant_id, outlet_id, register_id, device_id, created_by,
        created_at_device, clock_offset_ms, occurred_at, business_date,
        command_id, schema_version, app_version,
        invoice_no, invoice_prefix, invoice_period, invoice_seq, invoice_conflict_idx,
        shift_id, legal_entity_id, status,
        price_tax_mode, tax_profile, tax_rate, service_charge_rate, service_charge_taxable,
        cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
        gross_total, line_discount_total, bill_discount_total, net_subtotal,
        service_charge, tax_base, tax_amount, dpp, grand_total, rounding
      ) VALUES (
        ${sale124Id}::uuid, ${tenantId}::uuid, ${out1.id}::uuid, ${reg1.id}::uuid, ${dev1.deviceId}::uuid, ${cashierId}::uuid,
        '2026-11-17T10:00:00.000Z', 0, '2026-11-17T10:00:00.000Z', '2026-11-17',
        ${sale124CmdId}::uuid, 1, 'v1.0.0',
        'OUT01-POS01-1126-000124', 'OUT01-POS01', '1126', 124, 0,
        ${shiftId}::uuid, ${le.id}::uuid, 'PAID',
        'EXCLUSIVE', 'PPN', '11.0000', '0.0000', false,
        100, 'id-ID', true,
        50000, 0, 0, 50000,
        0, 50000, 5500, 50000, 55500, 0
      )
    `)

    await tx.execute(sql`
      INSERT INTO sale_payment (
        id, tenant_id, sale_id, shift_id, outlet_id, business_date, seq,
        method_id, method_code, method_name, method_kind,
        amount_applied, reference, is_rounding_settler
      ) VALUES (
        ${idGen.newId()}::uuid, ${tenantId}::uuid, ${sale124Id}::uuid, ${shiftId}::uuid, ${out1.id}::uuid, '2026-11-17', 1,
        ${qrisMethod.id}::uuid, 'QRIS', 'QRIS', 'NON_CASH',
        55500, 'QRIS-124', false
      )
    `)

    // Invoice 000125: gross 20.000; discount 2.000; S2 18.000; tax 1.980; rounding +20; total 20.000 (CASH, cashier2Id)
    await tx.execute(sql`
      INSERT INTO sale (
        id, tenant_id, outlet_id, register_id, device_id, created_by,
        created_at_device, clock_offset_ms, occurred_at, business_date,
        command_id, schema_version, app_version,
        invoice_no, invoice_prefix, invoice_period, invoice_seq, invoice_conflict_idx,
        shift_id, legal_entity_id, status,
        price_tax_mode, tax_profile, tax_rate, service_charge_rate, service_charge_taxable,
        cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
        gross_total, line_discount_total, bill_discount_total, net_subtotal,
        service_charge, tax_base, tax_amount, dpp, grand_total, rounding
      ) VALUES (
        ${sale125Id}::uuid, ${tenantId}::uuid, ${out1.id}::uuid, ${reg1.id}::uuid, ${dev1.deviceId}::uuid, ${cashier2Id}::uuid,
        '2026-11-17T11:00:00.000Z', 0, '2026-11-17T11:00:00.000Z', '2026-11-17',
        ${sale125CmdId}::uuid, 1, 'v1.0.0',
        'OUT01-POS01-1126-000125', 'OUT01-POS01', '1126', 125, 0,
        ${shiftId}::uuid, ${le.id}::uuid, 'PAID',
        'EXCLUSIVE', 'PPN', '11.0000', '0.0000', false,
        100, 'id-ID', true,
        20000, 2000, 0, 18000,
        0, 18000, 1980, 18000, 19980, 20
      )
    `)

    await tx.execute(sql`
      INSERT INTO sale_payment (
        id, tenant_id, sale_id, shift_id, outlet_id, business_date, seq,
        method_id, method_code, method_name, method_kind,
        amount_applied, cash_tendered, change_given, is_rounding_settler
      ) VALUES (
        ${idGen.newId()}::uuid, ${tenantId}::uuid, ${sale125Id}::uuid, ${shiftId}::uuid, ${out1.id}::uuid, '2026-11-17', 1,
        ${cashMethodId}::uuid, 'CASH', 'Tunai', 'CASH',
        20000, 20000, 0, true
      )
    `)

    // Invoice 000126: VOID (30.000, must be excluded from sales & payment methods)
    await tx.execute(sql`
      INSERT INTO sale (
        id, tenant_id, outlet_id, register_id, device_id, created_by,
        created_at_device, clock_offset_ms, occurred_at, business_date,
        command_id, schema_version, app_version,
        invoice_no, invoice_prefix, invoice_period, invoice_seq, invoice_conflict_idx,
        shift_id, legal_entity_id, status,
        voided_at, voided_by, void_approved_by, void_reason_code, void_reason_text, void_command_id,
        price_tax_mode, tax_profile, tax_rate, service_charge_rate, service_charge_taxable,
        cash_rounding_unit, receipt_locale, legal_entity_is_pkp,
        gross_total, line_discount_total, bill_discount_total, net_subtotal,
        service_charge, tax_base, tax_amount, dpp, grand_total, rounding
      ) VALUES (
        ${sale126VoidId}::uuid, ${tenantId}::uuid, ${out1.id}::uuid, ${reg1.id}::uuid, ${dev1.deviceId}::uuid, ${cashierId}::uuid,
        '2026-11-17T12:00:00.000Z', 0, '2026-11-17T12:00:00.000Z', '2026-11-17',
        ${sale126CmdId}::uuid, 1, 'v1.0.0',
        'OUT01-POS01-1126-000126', 'OUT01-POS01', '1126', 126, 0,
        ${shiftId}::uuid, ${le.id}::uuid, 'VOID',
        '2026-11-17T12:05:00.000Z', ${cashierId}::uuid, ${ownerId}::uuid, 'SALAH_INPUT', 'Salah input', ${void126CmdId}::uuid,
        'EXCLUSIVE', 'PPN', '11.0000', '0.0000', false,
        100, 'id-ID', true,
        30000, 0, 0, 30000,
        0, 30000, 3300, 30000, 33300, 0
      )
    `)

    await tx.execute(sql`
      INSERT INTO sale_payment (
        id, tenant_id, sale_id, shift_id, outlet_id, business_date, seq,
        method_id, method_code, method_name, method_kind,
        amount_applied, cash_tendered, change_given, is_rounding_settler
      ) VALUES (
        ${idGen.newId()}::uuid, ${tenantId}::uuid, ${sale126VoidId}::uuid, ${shiftId}::uuid, ${out1.id}::uuid, '2026-11-17', 1,
        ${cashMethodId}::uuid, 'CASH', 'Tunai', 'CASH',
        33300, 35000, 1700, true
      )
    `)

    // Credit Note NK-1126-000001 on 2026-11-17: refund 17.900 (net 16.110 + tax 1.772 + rounding +18)
    await tx.execute(sql`
      INSERT INTO credit_note (
        id, tenant_id, outlet_id, register_id, device_id, created_by,
        created_at_device, clock_offset_ms, occurred_at, business_date,
        command_id, schema_version, app_version,
        cn_no, cn_prefix, cn_period, cn_seq, cn_conflict_idx,
        original_sale_id, original_invoice_no, shift_id, status,
        reason_code, reason_text, approved_by,
        price_tax_mode, cash_rounding_unit, receipt_locale,
        net_total, service_total, tax_total, refund_gross, rounding
      ) VALUES (
        ${cn1Id}::uuid, ${tenantId}::uuid, ${out1.id}::uuid, ${reg1.id}::uuid, ${dev1.deviceId}::uuid, ${cashierId}::uuid,
        '2026-11-17T13:00:00.000Z', 0, '2026-11-17T13:00:00.000Z', '2026-11-17',
        ${cn1CmdId}::uuid, 1, 'v1.0.0',
        'OUT01-POS01-NK-1126-000001', 'OUT01-POS01', '1126', 1, 0,
        ${sale123Id}::uuid, 'OUT01-POS01-1126-000123', ${shiftId}::uuid, 'POSTED',
        'RUSAK', 'Kemasan rusak', ${ownerId}::uuid,
        'EXCLUSIVE', 100, 'id-ID',
        16110, 0, 1772, 17882, 18
      )
    `)

    await tx.execute(sql`
      INSERT INTO credit_note_refund (
        id, tenant_id, credit_note_id, shift_id, seq,
        method_id, method_code, method_name, method_kind, amount_applied
      ) VALUES (
        ${idGen.newId()}::uuid, ${tenantId}::uuid, ${cn1Id}::uuid, ${shiftId}::uuid, 1,
        ${cashMethodId}::uuid, 'CASH', 'Tunai', 'CASH', 17900
      )
    `)
  })

  const ownerActor: ReportActorContext = {
    tenantId,
    appUserId: ownerId,
    outletIds: null,
    permissions: new Set(PERMISSION_CODES),
  }

  const managerOut1Actor: ReportActorContext = {
    tenantId,
    appUserId: idGen.newId(),
    outletIds: [out1.id],
    permissions: new Set(['report.view']),
  }

  const managerOut2Actor: ReportActorContext = {
    tenantId,
    appUserId: idGen.newId(),
    outletIds: [out2.id],
    permissions: new Set(['report.view']),
  }

  const cashierActorNoReport: ReportActorContext = {
    tenantId,
    appUserId: cashierId,
    outletIds: [out1.id],
    permissions: new Set(['sale.create']),
  }

  return {
    slug,
    tenantId,
    ownerId,
    cashierId,
    cashier2Id,
    le,
    out1,
    out2,
    reg1,
    reg2,
    regOut2,
    dev1,
    dev2,
    devOut2,
    qrisMethod,
    transferMethod,
    shiftId,
    sale123Id,
    sale124Id,
    sale125Id,
    sale126VoidId,
    cn1Id,
    catalogRefs,
    ownerIdentity,
    ownerActor,
    managerOut1Actor,
    managerOut2Actor,
    cashierActorNoReport,
  }
}
