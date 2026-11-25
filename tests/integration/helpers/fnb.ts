import { webcrypto } from 'node:crypto'
import type { Client } from 'pg'
import { createIdGenerator } from '~/lib/kernel'
import { appClient, withClient } from './db'
import {
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
import type { CatalogActor } from '~/modules/catalog/public'
import type { FnbActor } from '~/modules/fnb/public'
import type { SyncDeviceIdentity } from '~/modules/sync/public'
import { masterTx } from './master'
import { uniqueSlug } from './tenants'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

export function newTestId(): string {
  return idGen.newId()
}

export interface FnbTestFixture {
  readonly tenantId: string
  readonly slug: string
  readonly actor: IdentityAuthActor
  readonly catalogActor: CatalogActor
  readonly fnbActor: FnbActor
  readonly appUserId: string
  readonly outletA: string
  readonly outletB: string
  readonly cashierRegId: string
  readonly waiterRegId: string
  readonly cashierDev: SyncDeviceIdentity
  readonly waiterDev: SyncDeviceIdentity
  readonly categoryId: string
  readonly pcsUomId: string
  readonly grUomId: string
  readonly menuProductId: string
  readonly menuSkuId: string
  readonly menu2ProductId: string
  readonly menu2SkuId: string
  readonly retailProductId: string
  readonly ingTrackedSkuId: string
  readonly ingUntrackedSkuId: string
  readonly tableA1Id: string
}

export async function setupFnbTenant(prefix: string): Promise<FnbTestFixture> {
  const slug = uniqueSlug(prefix)
  const email = `owner-${slug}@example.test`
  const created = await createTenant(
    { platformUserId: idGen.newId(), email: `op-${slug}@example.test` },
    { name: `Fnb ${slug}`, slug, ownerEmail: email, ownerDisplayName: 'Owner Fnb' },
  )
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
  const catalogActor: CatalogActor = {
    tenantId: created.tenantId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
  }
  const fnbActor: FnbActor = {
    tenantId: created.tenantId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
  }

  const le = await createLegalEntity(actor, { name: `PT ${slug}`, isPkp: false })
  const outA = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUTA',
    name: 'Outlet A',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })
  const outB = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUTB',
    name: 'Outlet B',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })

  const cashierReg = await createRegister(actor, {
    outletId: outA.id,
    code: 'CAS1',
    name: 'Cashier 1',
    registerType: 'CASHIER',
    invoicePrefix: 'CAS1',
  })
  const pairC = await createPairingCode(actor, cashierReg.id)
  const enrC = await enrollDevice(
    { slug, code: pairC.code, device_name: 'Cashier Dev' },
    '10.10.0.1',
    { minDelayMs: 0 },
  )

  const waiterReg = await createRegister(actor, {
    outletId: outA.id,
    code: 'WTR1',
    name: 'Waiter 1',
    registerType: 'WAITER',
  })
  const pairW = await createPairingCode(actor, waiterReg.id)
  const enrW = await enrollDevice(
    { slug, code: pairW.code, device_name: 'Waiter Dev' },
    '10.10.0.2',
    { minDelayMs: 0 },
  )

  const seeded = await masterTx(created.tenantId, async (c, v) => {
    const categoryId = (
      await c.query<{ id: string }>(
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Menu Utama') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id
    const pcsUomId = (
      await c.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pcs') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id
    const grUomId = (
      await c.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name, allow_fraction) VALUES ($1, $2, 'gr', 'Gram', true) RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id

    const createProdAndSku = async (
      code: string,
      name: string,
      productType: 'MENU_FNB' | 'RETAIL',
      trackStock: boolean,
      uomId: string,
    ) => {
      const pId = (
        await c.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, product_type, base_uom_id, track_stock)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [created.tenantId, v, categoryId, code, name, productType, uomId, trackStock],
        )
      ).rows[0]!.id
      const sId = (
        await c.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [created.tenantId, v, pId, `${code}-01`],
        )
      ).rows[0]!.id
      await c.query(
        `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base) VALUES ($1, $2, $3, $4, 1, true)`,
        [created.tenantId, v, sId, uomId],
      )
      return { productId: pId, skuId: sId }
    }

    const menu1 = await createProdAndSku('NASGOR', 'Nasi Goreng', 'MENU_FNB', false, pcsUomId)
    const menu2 = await createProdAndSku('AYAMBK', 'Ayam Bakar', 'MENU_FNB', false, pcsUomId)
    const ing1 = await createProdAndSku('BERAS', 'Beras Putih', 'RETAIL', true, grUomId)
    const ing2 = await createProdAndSku('GARAM', 'Garam Dapur', 'RETAIL', false, grUomId)

    const tableA1Id = (
      await c.query<{ id: string }>(
        `INSERT INTO fnb_table (tenant_id, outlet_id, code, area, capacity, version)
         VALUES ($1, $2, 'T01', 'Indoor', 4, $3) RETURNING id`,
        [created.tenantId, outA.id, v],
      )
    ).rows[0]!.id

    return {
      categoryId,
      pcsUomId,
      grUomId,
      menuProductId: menu1.productId,
      menuSkuId: menu1.skuId,
      menu2ProductId: menu2.productId,
      menu2SkuId: menu2.skuId,
      retailProductId: ing1.productId,
      ingTrackedSkuId: ing1.skuId,
      ingUntrackedSkuId: ing2.skuId,
      tableA1Id,
    }
  })

  return {
    tenantId: created.tenantId,
    slug,
    actor,
    catalogActor,
    fnbActor,
    appUserId: created.ownerInvite.appUserId,
    outletA: outA.id,
    outletB: outB.id,
    cashierRegId: cashierReg.id,
    waiterRegId: waiterReg.id,
    cashierDev: {
      tenantId: created.tenantId,
      deviceId: enrC.device_id,
      registerId: cashierReg.id,
      outletId: outA.id,
      registerType: 'CASHIER',
    },
    waiterDev: {
      tenantId: created.tenantId,
      deviceId: enrW.device_id,
      registerId: waiterReg.id,
      outletId: outA.id,
      registerType: 'WAITER',
    },
    ...seeded,
  }
}

export async function withFnbAppTx<T>(
  tenantId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(appClient, async (c) => {
    await c.query('BEGIN')
    try {
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      const res = await fn(c)
      await c.query('COMMIT')
      return res
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {})
      throw err
    }
  })
}

export async function seedIdempotencyCommand(
  c: Client,
  f: FnbTestFixture,
  commandId: string = idGen.newId(),
): Promise<string> {
  await c.query(
    `INSERT INTO idempotency_command
      (command_id, tenant_id, device_id, register_id, outlet_id, command_type, channel, schema_version, payload_hash, status, result)
     VALUES ($1, $2, $3, $4, $5, 'FinalizeSale', 'ONLINE', 1, repeat('a', 64), 'ACKED', '{}'::jsonb)`,
    [commandId, f.tenantId, f.waiterDev.deviceId, f.waiterRegId, f.outletA],
  )
  return commandId
}

export async function seedOpenBill(
  c: Client,
  f: FnbTestFixture,
  opts?: { billId?: string; tableId?: string; billRef?: string; status?: 'OPEN' | 'PAID' },
): Promise<{ billId: string; commandId: string }> {
  const billId = opts?.billId ?? idGen.newId()
  const commandId = await seedIdempotencyCommand(c, f)
  await c.query(
    `INSERT INTO bill
      (id, tenant_id, outlet_id, register_id, device_id, created_by, created_at_device, clock_offset_ms, occurred_at, business_date, command_id, schema_version,
       table_id, bill_ref, status, lease_device_id, lease_register_id)
     VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), '2026-11-24', $7, 1, $8, $9, $10, $5, $4)`,
    [
      billId,
      f.tenantId,
      f.outletA,
      f.waiterRegId,
      f.waiterDev.deviceId,
      f.appUserId,
      commandId,
      opts?.tableId ?? f.tableA1Id,
      opts?.billRef ?? 'Meja T01',
      opts?.status ?? 'OPEN',
    ],
  )
  return { billId, commandId }
}
