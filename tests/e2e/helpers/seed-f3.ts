import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createIdGenerator } from '../../../src/lib/kernel'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  addTaxRate,
  createInvite,
  createLegalEntity,
  createOutlet,
  createPairingCode,
  createRegister,
  createTenant,
  getTenantAuthMetadataBySlug,
  listRolesWithPermissions,
  redeemInvite,
  savePaymentMethod,
  setPin,
  updateOutletTaxSettings,
  type IdentityAuthActor,
} from '../../../src/modules/identity/public'
import { PERMISSION_CODES } from '../../../src/modules/identity/shared'
import { writeMaster } from '../../../src/modules/sync/public'
import { withTenant } from '../../../src/server/db'

/**
 * Seed for the F3 tests (K01-K12). All data is created through server services (not the UI).
 * The test PINs exist only in this file and are never printed to the log.
 */

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

/** Today's local date in Asia/Jakarta (UTC+7), format YYYY-MM-DD. */
function jakartaToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
}

export const F3_OWNER_PASSWORD = 'Password123!'
export const F3_STAFF_PASSWORD = 'StaffPassword123!'
export const F3_CASHIER_PIN = '482915'
export const F3_SUPERVISOR_PIN = '659031'
export const F3_CASHIER_NAME = 'Dewi'
export const F3_SUPERVISOR_NAME = 'Sari'

export const F3_PRODUCTS = {
  kopi: { code: 'KOPI', name: 'Kopi Hitam', barcode: '8990000000011', price: 18500 },
  teh: { code: 'TEH', name: 'Teh Tarik', barcode: '8990000000028', price: 12000 },
  roti: { code: 'ROTI', name: 'Roti Bakar', barcode: '8990000000035', price: 15000 },
} as const

export interface F3Tenant {
  tenantId: string
  slug: string
  ownerActor: IdentityAuthActor
  legalEntityId: string
  outletId: string
  reg1Id: string
  reg2Id: string
  cashierUserId: string
  supervisorUserId: string
  productIds: Record<keyof typeof F3_PRODUCTS, { productId: string; skuId: string; barcode: string; name: string; price: number }>
  pcsUomId: string
}

/**
 * Creates the F3 tenant: owner, inactive PKP company, OUT01 (11% exclusive VAT, rounding to 100),
 * registers POS01 & POS02, staff Dewi (cashier) and Sari (supervisor), QRIS payment method, and a catalog of 3 products.
 */
export async function createF3Tenant(prefix: string): Promise<F3Tenant> {
  const slug = `${prefix}-${idGen.newId().slice(-8)}`.toLowerCase()
  const ownerEmail = `owner-${slug}@example.test`
  const created = await createTenant(
    { platformUserId: idGen.newId(), email: `op-${slug}@example.test` },
    { name: `F3 ${slug}`, slug, ownerEmail, ownerDisplayName: 'Owner F3' },
  )
  __clearTenantCacheForTests()
  __clearDeviceAuthCacheForTests()
  const meta = await getTenantAuthMetadataBySlug(slug)
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email: ownerEmail,
    code: created.ownerInvite.code,
    password: F3_OWNER_PASSWORD,
  })
  const ownerActor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }

  const le = await createLegalEntity(ownerActor, { name: 'PT F3 Uji', isPkp: true, npwp: '012345678901234' })
  const outlet = await createOutlet(ownerActor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })
  await addTaxRate(ownerActor, {
    taxCode: 'PPN',
    outletId: null,
    effectiveFrom: jakartaToday(),
    rate: '11',
  })
  await updateOutletTaxSettings(ownerActor, {
    outletId: outlet.id,
    taxProfile: 'PPN',
    priceTaxMode: 'EXCLUSIVE',
    cashRoundingUnit: 100,
    serviceChargeEnabled: false,
    serviceChargeRate: '0',
    serviceChargeTaxable: true,
  })

  const reg1 = await createRegister(ownerActor, {
    outletId: outlet.id,
    code: 'POS01',
    name: 'Kasir 1',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const reg2 = await createRegister(ownerActor, {
    outletId: outlet.id,
    code: 'POS02',
    name: 'Kasir 2',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS02',
  })

  await savePaymentMethod(ownerActor, {
    code: 'QRIS',
    name: 'QRIS',
    kind: 'NON_CASH',
    requiresReference: false,
    sortOrder: 2,
    isActive: true,
  })

  const roles = await listRolesWithPermissions(ownerActor)
  const cashierRole = roles.find((r) => r.code === 'CASHIER')!
  const managerRole = roles.find((r) => r.code === 'MANAGER')!

  const cashierEmail = `dewi-${slug}@example.test`
  const cashierInvite = await createInvite(ownerActor, {
    email: cashierEmail,
    displayName: F3_CASHIER_NAME,
    roleId: cashierRole.id,
    outletIds: [outlet.id],
  })
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email: cashierEmail,
    code: cashierInvite.code,
    password: F3_STAFF_PASSWORD,
  })
  const supervisorEmail = `sari-${slug}@example.test`
  const supervisorInvite = await createInvite(ownerActor, {
    email: supervisorEmail,
    displayName: F3_SUPERVISOR_NAME,
    roleId: managerRole.id,
    outletIds: [outlet.id],
  })
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email: supervisorEmail,
    code: supervisorInvite.code,
    password: F3_STAFF_PASSWORD,
  })

  await setPin(ownerActor, { userId: cashierInvite.appUserId, pin: F3_CASHIER_PIN })
  await setPin(ownerActor, { userId: supervisorInvite.appUserId, pin: F3_SUPERVISOR_PIN })

  const catalog = await seedF3Catalog(created.tenantId, ownerActor.appUserId)

  return {
    tenantId: created.tenantId,
    slug,
    ownerActor,
    legalEntityId: le.id,
    outletId: outlet.id,
    reg1Id: reg1.id,
    reg2Id: reg2.id,
    cashierUserId: cashierInvite.appUserId,
    supervisorUserId: supervisorInvite.appUserId,
    productIds: catalog.productIds,
    pcsUomId: catalog.pcsUomId,
  }
}

/** Creates a pairing code for one register (issued by the owner). */
export async function pairingCodeFor(t: F3Tenant, registerId: string): Promise<string> {
  const res = await createPairingCode(t.ownerActor, registerId)
  return res.code
}

async function seedF3Catalog(
  tenantId: string,
  actorUserId: string,
): Promise<{
  pcsUomId: string
  productIds: F3Tenant['productIds']
}> {
  const nowIso = new Date().toISOString()
  const catId = idGen.newId()
  const pcsId = idGen.newId()
  const ids: F3Tenant['productIds'] = {} as F3Tenant['productIds']
  const entries = Object.entries(F3_PRODUCTS) as Array<
    [keyof typeof F3_PRODUCTS, (typeof F3_PRODUCTS)[keyof typeof F3_PRODUCTS]]
  >

  await withTenant(tenantId, async (tx) => {
    await writeMaster(tx, { actorUserId }, async (w) => {
      await tx.execute(sql`
        INSERT INTO category (id, tenant_id, version, created_at, updated_at, created_by, updated_by, name, sort_order)
        VALUES (${catId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, 'Minuman F3', 0)
      `)
      await tx.execute(sql`
        INSERT INTO uom (id, tenant_id, version, created_at, updated_at, created_by, updated_by, code, name, allow_fraction)
        VALUES (${pcsId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, 'pcs', 'Pieces', false)
      `)
      for (const [key, p] of entries) {
        const productId = idGen.newId()
        const skuId = idGen.newId()
        const skuUomId = idGen.newId()
        const priceId = idGen.newId()
        await tx.execute(sql`
          INSERT INTO product (id, tenant_id, version, created_at, updated_at, created_by, updated_by, category_id, code, name, product_type, has_variants, base_uom_id, sort_order)
          VALUES (${productId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${catId}::uuid, ${p.code}, ${p.name}, 'RETAIL', false, ${pcsId}::uuid, 0)
        `)
        await tx.execute(sql`
          INSERT INTO sku (id, tenant_id, version, created_at, updated_at, created_by, updated_by, product_id, sku_code, variant_label, is_default, is_active, sort_order)
          VALUES (${skuId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${productId}::uuid, ${p.code}, NULL, true, true, 0)
        `)
        await tx.execute(sql`
          INSERT INTO sku_uom (id, tenant_id, version, created_at, updated_at, created_by, updated_by, sku_id, uom_id, conversion_factor, is_base, barcode)
          VALUES (${skuUomId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${skuId}::uuid, ${pcsId}::uuid, 1, true, ${p.barcode})
        `)
        await tx.execute(sql`
          INSERT INTO price_entry (id, tenant_id, version, created_at, updated_at, created_by, updated_by, sku_id, uom_id, outlet_id, price, currency)
          VALUES (${priceId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${skuId}::uuid, ${pcsId}::uuid, NULL, ${p.price}, 'IDR')
        `)
        ids[key] = { productId, skuId, barcode: p.barcode, name: p.name, price: p.price }
      }
    })
  })
  return { pcsUomId: pcsId, productIds: ids }
}
