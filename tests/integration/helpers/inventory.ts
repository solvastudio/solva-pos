import { webcrypto } from 'node:crypto'
import { createIdGenerator } from '~/lib/kernel'
import {
  createLegalEntity,
  createOutlet,
  createTenant,
  getTenantAuthMetadataBySlug,
  redeemInvite,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
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

export interface InventoryTenant {
  readonly tenantId: string
  readonly slug: string
  readonly actor: IdentityAuthActor
  readonly actorUserId: string
  readonly outletA: string
  readonly outletB: string
  readonly skuA: string
  readonly skuB: string
  readonly pcsUomId: string
}

/**
 * Tenant uji inventori: owner, dua outlet, dua SKU (base UOM `pcs`) dengan `sku_uom` dan harga default.
 * Stok awal nol; pemanggil membuat movement lewat `applyMovements`.
 */
export async function setupInventoryTenant(prefix: string): Promise<InventoryTenant> {
  const slug = uniqueSlug(prefix)
  const email = `owner-${slug}@example.test`
  const created = await createTenant(
    { platformUserId: idGen.newId(), email: `op-${slug}@example.test` },
    { name: `Inv ${slug}`, slug, ownerEmail: email, ownerDisplayName: 'Owner' },
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
  const le = await createLegalEntity(actor, { name: 'PT Inv', isPkp: false })
  const outletA = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })
  const outletB = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT02',
    name: 'Outlet 02',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'EXCLUSIVE',
  })

  const seeded = await masterTx(created.tenantId, async (c, v) => {
    const catId = (
      await c.query<{ id: string }>(
        `INSERT INTO category (tenant_id, version, name) VALUES ($1, $2, 'Inv') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id
    const pcsId = (
      await c.query<{ id: string }>(
        `INSERT INTO uom (tenant_id, version, code, name) VALUES ($1, $2, 'pcs', 'Pcs') RETURNING id`,
        [created.tenantId, v],
      )
    ).rows[0]!.id
    const makeSku = async (code: string) => {
      const pId = (
        await c.query<{ id: string }>(
          `INSERT INTO product (tenant_id, version, category_id, code, name, base_uom_id) VALUES ($1, $2, $3, $4, $4, $5) RETURNING id`,
          [created.tenantId, v, catId, code, pcsId],
        )
      ).rows[0]!.id
      const sId = (
        await c.query<{ id: string }>(
          `INSERT INTO sku (tenant_id, version, product_id, sku_code, is_default) VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [created.tenantId, v, pId, code],
        )
      ).rows[0]!.id
      await c.query(
        `INSERT INTO sku_uom (tenant_id, version, sku_id, uom_id, conversion_factor, is_base) VALUES ($1, $2, $3, $4, 1, true)`,
        [created.tenantId, v, sId, pcsId],
      )
      return sId
    }
    const skuA = await makeSku('INV-A')
    const skuB = await makeSku('INV-B')
    return { skuA, skuB, pcsId }
  })

  return {
    tenantId: created.tenantId,
    slug,
    actor,
    actorUserId: created.ownerInvite.appUserId,
    outletA: outletA.id,
    outletB: outletB.id,
    skuA: seeded.skuA,
    skuB: seeded.skuB,
    pcsUomId: seeded.pcsId,
  }
}

/** Pembaruan master (kelas M) lewat writeMaster-equivalent: versi dinaikkan lewat masterTx. */
export async function masterUpdate(tenantId: string, sqlText: string, params: unknown[]): Promise<void> {
  await masterTx(tenantId, async (c, v) => {
    await c.query(sqlText, [...params, v])
  })
}

/** Mengaktifkan stok outlet (BR-STK-004) pada waktu tertentu. */
export async function enableOutletInventory(tenantId: string, outletId: string, at: string): Promise<void> {
  await masterUpdate(tenantId, "UPDATE outlet SET inventory_enabled_at = $3, version = $4 WHERE tenant_id = $1 AND id = $2", [tenantId, outletId, at])
}

export async function disableOutletInventory(tenantId: string, outletId: string): Promise<void> {
  await masterUpdate(tenantId, "UPDATE outlet SET inventory_enabled_at = NULL, version = $3 WHERE tenant_id = $1 AND id = $2", [tenantId, outletId])
}

/** Mengubah flag produk milik SKU (track_stock / product_type) — produk adalah master kelas M. */
export async function setSkuProductFlags(
  tenantId: string,
  skuId: string,
  flags: { trackStock?: boolean; productType?: "RETAIL" | "MENU_FNB" },
): Promise<void> {
  if (flags.trackStock !== undefined) {
    await masterUpdate(tenantId, "UPDATE product SET track_stock = $3, version = $4 WHERE tenant_id = $1 AND id = (SELECT product_id FROM sku WHERE id = $2)", [tenantId, skuId, flags.trackStock])
  }
  if (flags.productType !== undefined) {
    await masterUpdate(tenantId, "UPDATE product SET product_type = $3, version = $4 WHERE tenant_id = $1 AND id = (SELECT product_id FROM sku WHERE id = $2)", [tenantId, skuId, flags.productType])
  }
}
