import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createIdGenerator } from '../../../src/lib/kernel'
import {
  createModifier,
  createModifierGroup,
  linkModifierGroupProduct,
  saveRecipe,
  type CatalogActor,
} from '../../../src/modules/catalog/public'
import { createTable, type FnbActor } from '../../../src/modules/fnb/public'
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

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    webcrypto.getRandomValues(b)
    return b[0]!
  },
})

function jakartaToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
}

export const F5_OWNER_PASSWORD = 'Password123!'
export const F5_STAFF_PASSWORD = 'StaffPassword123!'
export const F5_CASHIER_NAME = 'Dewi'
export const F5_CASHIER_PIN = '482915'
export const F5_WAITER_NAME = 'Rina'
export const F5_WAITER_PIN = '193847'

export interface F5Tenant {
  tenantId: string
  slug: string
  ownerActor: IdentityAuthActor
  outletId: string
  cashierRegId: string
  waiterRegId: string
  tableM05Id: string
  tableM06Id: string
  cashierUserId: string
  waiterUserId: string
  extraModId: string
  menus: {
    nasgor: { productId: string; skuId: string; name: string; price: number }
    esteh: { productId: string; skuId: string; name: string; price: number }
    ayambakar: { productId: string; skuId: string; name: string; price: number }
  }
}

export async function createF5Tenant(prefix: string): Promise<F5Tenant> {
  const slug = `${prefix}-${idGen.newId().slice(-8)}`.toLowerCase()
  const ownerEmail = `owner-${slug}@example.test`
  const created = await createTenant(
    { platformUserId: idGen.newId(), email: `op-${slug}@example.test` },
    { name: `F5 ${slug}`, slug, ownerEmail, ownerDisplayName: 'Owner F5' },
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
    password: F5_OWNER_PASSWORD,
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
  const catalogActor: CatalogActor = {
    tenantId: created.tenantId,
    appUserId: ownerActor.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
  }
  const fnbActor: FnbActor = {
    tenantId: created.tenantId,
    appUserId: ownerActor.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
  }

  const le = await createLegalEntity(ownerActor, { name: 'PT F5 Uji', isPkp: true, npwp: '012345678901234' })
  const outlet = await createOutlet(ownerActor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })
  await addTaxRate(ownerActor, {
    taxCode: 'PB1',
    outletId: null,
    effectiveFrom: jakartaToday(),
    rate: '10',
  })
  await updateOutletTaxSettings(ownerActor, {
    outletId: outlet.id,
    taxProfile: 'PB1',
    priceTaxMode: 'EXCLUSIVE',
    cashRoundingUnit: 100,
    serviceChargeEnabled: true,
    serviceChargeRate: '5',
    serviceChargeTaxable: true,
  })

  const cashierReg = await createRegister(ownerActor, {
    outletId: outlet.id,
    code: 'POS01',
    name: 'Kasir Utama',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const waiterReg = await createRegister(ownerActor, {
    outletId: outlet.id,
    code: 'WTR01',
    name: 'Pelayan 1',
    registerType: 'WAITER',
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
  const waiterRole = roles.find((r) => r.code === 'WAITER') ?? cashierRole

  const dewiEmail = `dewi-${slug}@example.test`
  const dewiInvite = await createInvite(ownerActor, {
    email: dewiEmail,
    displayName: F5_CASHIER_NAME,
    roleId: cashierRole.id,
    outletIds: [outlet.id],
  })
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email: dewiEmail,
    code: dewiInvite.code,
    password: F5_STAFF_PASSWORD,
  })
  await setPin(ownerActor, { userId: dewiInvite.appUserId, pin: F5_CASHIER_PIN })

  const rinaEmail = `rina-${slug}@example.test`
  const rinaInvite = await createInvite(ownerActor, {
    email: rinaEmail,
    displayName: F5_WAITER_NAME,
    roleId: waiterRole.id,
    outletIds: [outlet.id],
  })
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email: rinaEmail,
    code: rinaInvite.code,
    password: F5_STAFF_PASSWORD,
  })
  await setPin(ownerActor, { userId: rinaInvite.appUserId, pin: F5_WAITER_PIN })

  const tableM05 = await createTable(fnbActor, {
    outletId: outlet.id,
    area: 'Utama',
    code: 'M05',
    capacity: 4,
    sortOrder: 1,
  })
  const tableM06 = await createTable(fnbActor, {
    outletId: outlet.id,
    area: 'Utama',
    code: 'M06',
    capacity: 4,
    sortOrder: 2,
  })

  const nowIso = new Date().toISOString()
  const catId = idGen.newId()
  const pcsId = idGen.newId()
  const grId = idGen.newId()

  const menuDefs = [
    { key: 'nasgor', code: 'NASGOR', name: 'Nasi Goreng', price: 35000 },
    { key: 'esteh', code: 'ESTEH', name: 'Es Teh', price: 8000 },
    { key: 'ayambakar', code: 'AYAM', name: 'Ayam Bakar', price: 42500 },
  ] as const

  const menus = {} as F5Tenant['menus']
  const ingSkuId = idGen.newId()
  const ingProdId = idGen.newId()

  await withTenant(created.tenantId, async (tx) => {
    await writeMaster(tx, { actorUserId: ownerActor.appUserId }, async (w) => {
      await tx.execute(sql`
        INSERT INTO category (id, tenant_id, version, created_at, updated_at, created_by, updated_by, name, sort_order)
        VALUES (${catId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, 'Makanan', 0)
      `)
      await tx.execute(sql`
        INSERT INTO uom (id, tenant_id, version, created_at, updated_at, created_by, updated_by, code, name, allow_fraction)
        VALUES
          (${pcsId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, 'pcs', 'Pieces', false),
          (${grId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, 'gr', 'Gram', true)
      `)
      await tx.execute(sql`
        INSERT INTO product (id, tenant_id, version, created_at, updated_at, created_by, updated_by, category_id, code, name, product_type, has_variants, base_uom_id, track_stock, sort_order)
        VALUES (${ingProdId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${catId}::uuid, 'ING-01', 'Beras', 'INGREDIENT', false, ${grId}::uuid, true, 99)
      `)
      await tx.execute(sql`
        INSERT INTO sku (id, tenant_id, version, created_at, updated_at, created_by, updated_by, product_id, sku_code, variant_label, is_default, is_active, sort_order)
        VALUES (${ingSkuId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${ingProdId}::uuid, 'ING-01', NULL, true, true, 0)
      `)

      for (const def of menuDefs) {
        const productId = idGen.newId()
        const skuId = idGen.newId()
        const skuUomId = idGen.newId()
        const priceId = idGen.newId()
        await tx.execute(sql`
          INSERT INTO product (id, tenant_id, version, created_at, updated_at, created_by, updated_by, category_id, code, name, product_type, has_variants, base_uom_id, track_stock, sort_order)
          VALUES (${productId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${catId}::uuid, ${def.code}, ${def.name}, 'MENU_FNB', false, ${pcsId}::uuid, false, 0)
        `)
        await tx.execute(sql`
          INSERT INTO sku (id, tenant_id, version, created_at, updated_at, created_by, updated_by, product_id, sku_code, variant_label, is_default, is_active, sort_order)
          VALUES (${skuId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${productId}::uuid, ${def.code}, NULL, true, true, 0)
        `)
        await tx.execute(sql`
          INSERT INTO sku_uom (id, tenant_id, version, created_at, updated_at, created_by, updated_by, sku_id, uom_id, conversion_factor, is_base)
          VALUES (${skuUomId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${skuId}::uuid, ${pcsId}::uuid, 1, true)
        `)
        await tx.execute(sql`
          INSERT INTO price_entry (id, tenant_id, version, created_at, updated_at, created_by, updated_by, sku_id, uom_id, outlet_id, price, currency)
          VALUES (${priceId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, ${skuId}::uuid, ${pcsId}::uuid, NULL, ${def.price}, 'IDR')
        `)
        menus[def.key] = { productId, skuId, name: def.name, price: def.price }
      }
    })
  })

  const modGroup = await createModifierGroup(catalogActor, {
    name: 'Pilihan Tambahan',
    selectionType: 'MULTI',
    minSelect: 0,
    maxSelect: 3,
  })
  const extraMod = await createModifier(catalogActor, {
    modifierGroupId: modGroup.id,
    name: 'Extra Sambal',
    priceDelta: 2000,
  })
  await linkModifierGroupProduct(catalogActor, {
    modifierGroupId: modGroup.id,
    productId: menus.ayambakar.productId,
    sortOrder: 1,
  })
  await linkModifierGroupProduct(catalogActor, {
    modifierGroupId: modGroup.id,
    productId: menus.nasgor.productId,
    sortOrder: 1,
  })
  await saveRecipe(catalogActor, {
    menuSkuId: menus.nasgor.skuId,
    items: [{ ingredientSkuId: ingSkuId, qty: '150' }],
  })

  return {
    tenantId: created.tenantId,
    slug,
    ownerActor,
    outletId: outlet.id,
    cashierRegId: cashierReg.id,
    waiterRegId: waiterReg.id,
    tableM05Id: tableM05.id,
    tableM06Id: tableM06.id,
    cashierUserId: dewiInvite.appUserId,
    waiterUserId: rinaInvite.appUserId,
    extraModId: extraMod.id,
    menus,
  }
}

export async function f5PairingCodeFor(t: F5Tenant, registerId: string): Promise<string> {
  const res = await createPairingCode(t.ownerActor, registerId)
  return res.code
}
