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
  getTenantAuthMetadataBySlug,
  redeemInvite,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { type SyncDeviceIdentity, writeMaster } from '~/modules/sync/public'
import { withTenant } from '~/server/db'

const benchIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

export interface SeededCatalogBenchmark {
  tenantId: string
  slug: string
  actorUserId: string
  outletAId: string
  outletBId: string
  outletCId: string
  registerAId: string
  registerBId: string
  registerCId: string
  pcsUomId: string
  dusUomId: string
  categoryId: string
  deviceA: SyncDeviceIdentity
  seedDurationMs: number
  counts: {
    products: number
    skus: number
    skuUoms: number
    availabilityOutletA: number
    priceEntriesOutletAAndDefault: number
  }
}

export interface SeedE2eTenantOptions {
  prefix?: string
  with5kCatalog?: boolean
  nullBarcodeEveryN?: number
}

export async function createThreeOutletE2eTenant(
  prefix = 'e2e',
  opts?: { ownerPassword?: string },
): Promise<{
  tenantId: string
  slug: string
  actorUserId: string
  ownerEmail: string
  ownerPassword: string | null
  outletAId: string
  outletBId: string
  outletCId: string
  registerAId: string
  registerBId: string
  registerCId: string
  actor: IdentityAuthActor
}> {
  const slug = `${prefix}-${benchIdGen.newId().slice(-8)}`
  const ownerEmail = `owner-${slug}@example.test`
  const op = { platformUserId: benchIdGen.newId(), email: `op-${slug}@example.test` }

  const created = await createTenant(op, {
    name: `Bench ${slug}`,
    slug,
    ownerEmail,
    ownerDisplayName: 'Bench Owner',
  })
  const meta = await getTenantAuthMetadataBySlug(slug)
  if (opts?.ownerPassword) {
    const redeemed = await redeemInvite({
      tenantId: created.tenantId,
      tenantSlug: slug,
      authOrgId: meta!.authOrgId,
      email: ownerEmail,
      code: created.ownerInvite.code,
      password: opts.ownerPassword,
    })
    if (!redeemed.ok) {
      throw new Error(`Failed to redeem owner invite for ${slug}`)
    }
  }
  const actor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }

  const le = await createLegalEntity(actor, { name: 'PT Bench', isPkp: false })
  const outletA = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const outletB = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT02',
    name: 'Outlet 02',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const outletC = await createOutlet(actor, {
    legalEntityId: le.id,
    code: 'OUT03',
    name: 'Outlet 03',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })

  const regA = await createRegister(actor, {
    outletId: outletA.id,
    code: 'POS01',
    name: 'Outlet 01 Cashier',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
  })
  const regB = await createRegister(actor, {
    outletId: outletB.id,
    code: 'POS01',
    name: 'Outlet 02 Cashier',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT02-POS01',
  })
  const regC = await createRegister(actor, {
    outletId: outletC.id,
    code: 'POS01',
    name: 'Outlet 03 Cashier',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT03-POS01',
  })

  return {
    tenantId: created.tenantId,
    slug,
    actorUserId: actor.appUserId,
    ownerEmail,
    ownerPassword: opts?.ownerPassword ?? null,
    outletAId: outletA.id,
    outletBId: outletB.id,
    outletCId: outletC.id,
    registerAId: regA.id,
    registerBId: regB.id,
    registerCId: regC.id,
    actor,
  }
}

/**
 * Seeds a synthetic catalog benchmark tenant using single `writeMaster` set-based bulk inserts
 * per large entity:
 * - 3 outlets (OUT01, OUT02, OUT03)
 * - 1,250 products x 4 variants = 5,000 SKUs
 * - 5,000 base `pcs` + 1,000 `dus` `sku_uom` rows with unique barcodes (nullable every N if specified)
 * - 5,000 default + 5,000 outlet A `price_entry` rows
 * - 5,000 `item_outlet_availability` rows per outlet (1,250 product-level + 3,750 SKU overrides)
 */
export async function seedCatalogBenchmark(
  prefix = 'bench',
  opts?: { nullBarcodeEveryN?: number },
): Promise<SeededCatalogBenchmark> {
  const startedAt = Date.now()
  const base = await createThreeOutletE2eTenant(prefix)
  const { tenantId, slug, actor, outletAId, outletBId, outletCId, registerAId, registerBId, registerCId } =
    base

  const pair = await createPairingCode(actor, registerAId)
  const enr = await enrollDevice(
    { slug, code: pair.code, device_name: 'Bench-POS' },
    '127.0.0.1',
    { minDelayMs: 0 },
  )

  const catId = benchIdGen.newId()
  const pcsId = benchIdGen.newId()
  const dusId = benchIdGen.newId()
  const nowIso = new Date().toISOString()
  const nullEvery = opts?.nullBarcodeEveryN ?? 0

  // 1. Category + UOMs in one writeMaster
  await withTenant(tenantId, async (tx) => {
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tx.execute(sql`
        INSERT INTO category (id, tenant_id, version, created_at, updated_at, created_by, updated_by, name, sort_order)
        VALUES (${catId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, 'Bench Category', 0)
      `)
      await tx.execute(sql`
        INSERT INTO uom (id, tenant_id, version, created_at, updated_at, created_by, updated_by, code, name, allow_fraction)
        VALUES
          (${pcsId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, 'pcs', 'Pieces', false),
          (${dusId}::uuid, ${w.tenantId}::uuid, ${w.version}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${w.actorUserId}::uuid, ${w.actorUserId}::uuid, 'dus', 'Dus', false)
      `)
    })
  })

  // 2. 1,250 products in one writeMaster
  await withTenant(tenantId, async (tx) => {
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tx.execute(sql`
        INSERT INTO product (
          id, tenant_id, version, created_at, updated_at, created_by, updated_by,
          category_id, code, name, product_type, has_variants, base_uom_id, sort_order
        )
        SELECT
          uuidv7(),
          ${w.tenantId}::uuid,
          ${w.version}::bigint,
          ${nowIso}::timestamptz,
          ${nowIso}::timestamptz,
          ${w.actorUserId}::uuid,
          ${w.actorUserId}::uuid,
          ${catId}::uuid,
          'BP-' || lpad(g::text, 4, '0'),
          'Bench Product ' || g::text,
          'RETAIL',
          true,
          ${pcsId}::uuid,
          g
        FROM generate_series(1, 1250) AS g
      `)
    })
  })

  // 3. 5,000 SKUs (1,250 x 4 variants) in one writeMaster
  await withTenant(tenantId, async (tx) => {
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tx.execute(sql`
        INSERT INTO sku (
          id, tenant_id, version, created_at, updated_at, created_by, updated_by,
          product_id, sku_code, variant_label, is_default, is_active, sort_order
        )
        SELECT
          uuidv7(),
          ${w.tenantId}::uuid,
          ${w.version}::bigint,
          ${nowIso}::timestamptz,
          ${nowIso}::timestamptz,
          ${w.actorUserId}::uuid,
          ${w.actorUserId}::uuid,
          p.id,
          p.code || '-V' || v::text,
          'Variant ' || v::text,
          false,
          true,
          v
        FROM product p
        CROSS JOIN generate_series(1, 4) AS v
        WHERE p.tenant_id = ${w.tenantId}::uuid
          AND p.deleted_at IS NULL
      `)
    })
  })

  // 4. 5,000 base pcs + 1,000 extra dus sku_uom rows in one writeMaster
  await withTenant(tenantId, async (tx) => {
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tx.execute(sql`
        WITH ranked_skus AS (
          SELECT id, row_number() OVER (ORDER BY id) AS rn
          FROM sku
          WHERE tenant_id = ${w.tenantId}::uuid AND deleted_at IS NULL
        )
        INSERT INTO sku_uom (
          id, tenant_id, version, created_at, updated_at, created_by, updated_by,
          sku_id, uom_id, conversion_factor, is_base, barcode
        )
        SELECT
          uuidv7(),
          ${w.tenantId}::uuid,
          ${w.version}::bigint,
          ${nowIso}::timestamptz,
          ${nowIso}::timestamptz,
          ${w.actorUserId}::uuid,
          ${w.actorUserId}::uuid,
          s.id,
          ${pcsId}::uuid,
          1,
          true,
          CASE WHEN ${nullEvery} > 0 AND (s.rn % ${nullEvery}) = 0 THEN NULL ELSE '89900' || lpad(s.rn::text, 8, '0') END
        FROM ranked_skus s
        UNION ALL
        SELECT
          uuidv7(),
          ${w.tenantId}::uuid,
          ${w.version}::bigint,
          ${nowIso}::timestamptz,
          ${nowIso}::timestamptz,
          ${w.actorUserId}::uuid,
          ${w.actorUserId}::uuid,
          s.id,
          ${dusId}::uuid,
          12,
          false,
          CASE WHEN ${nullEvery} > 0 AND (s.rn % ${nullEvery}) = 0 THEN NULL ELSE '89911' || lpad(s.rn::text, 8, '0') END
        FROM ranked_skus s
        WHERE s.rn <= 1000
      `)
    })
  })

  // 5. 5,000 default + 5,000 outlet A price_entry rows in one writeMaster
  await withTenant(tenantId, async (tx) => {
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tx.execute(sql`
        INSERT INTO price_entry (
          id, tenant_id, version, created_at, updated_at, created_by, updated_by,
          sku_id, uom_id, outlet_id, price, currency
        )
        SELECT
          uuidv7(),
          ${w.tenantId}::uuid,
          ${w.version}::bigint,
          ${nowIso}::timestamptz,
          ${nowIso}::timestamptz,
          ${w.actorUserId}::uuid,
          ${w.actorUserId}::uuid,
          s.id,
          ${pcsId}::uuid,
          NULL,
          15000,
          'IDR'
        FROM sku s
        WHERE s.tenant_id = ${w.tenantId}::uuid AND s.deleted_at IS NULL
        UNION ALL
        SELECT
          uuidv7(),
          ${w.tenantId}::uuid,
          ${w.version}::bigint,
          ${nowIso}::timestamptz,
          ${nowIso}::timestamptz,
          ${w.actorUserId}::uuid,
          ${w.actorUserId}::uuid,
          s.id,
          ${pcsId}::uuid,
          ${outletAId}::uuid,
          16500,
          'IDR'
        FROM sku s
        WHERE s.tenant_id = ${w.tenantId}::uuid AND s.deleted_at IS NULL
      `)
    })
  })

  // 6. 5,000 availability rows per outlet (1,250 product + 3,750 SKU overrides = 15,000 total across 3 outlets)
  await withTenant(tenantId, async (tx) => {
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tx.execute(sql`
        WITH outlets AS (
          SELECT unnest(ARRAY[${outletAId}::uuid, ${outletBId}::uuid, ${outletCId}::uuid]) AS oid
        ),
        skus_per_prod AS (
          SELECT id AS sku_id, product_id, row_number() OVER (PARTITION BY product_id ORDER BY id) AS vrn
          FROM sku
          WHERE tenant_id = ${w.tenantId}::uuid AND deleted_at IS NULL
        )
        INSERT INTO item_outlet_availability (
          id, tenant_id, version, created_at, updated_at, created_by, updated_by,
          outlet_id, product_id, sku_id, status, changed_at, changed_by
        )
        SELECT
          uuidv7(),
          ${w.tenantId}::uuid,
          ${w.version}::bigint,
          ${nowIso}::timestamptz,
          ${nowIso}::timestamptz,
          ${w.actorUserId}::uuid,
          ${w.actorUserId}::uuid,
          o.oid,
          p.id,
          NULL,
          'AVAILABLE',
          ${nowIso}::timestamptz,
          ${w.actorUserId}::uuid
        FROM outlets o
        CROSS JOIN product p
        WHERE p.tenant_id = ${w.tenantId}::uuid AND p.deleted_at IS NULL
        UNION ALL
        SELECT
          uuidv7(),
          ${w.tenantId}::uuid,
          ${w.version}::bigint,
          ${nowIso}::timestamptz,
          ${nowIso}::timestamptz,
          ${w.actorUserId}::uuid,
          ${w.actorUserId}::uuid,
          o.oid,
          sp.product_id,
          sp.sku_id,
          'AVAILABLE',
          ${nowIso}::timestamptz,
          ${w.actorUserId}::uuid
        FROM outlets o
        CROSS JOIN skus_per_prod sp
        WHERE sp.vrn <= 3
        ON CONFLICT ON CONSTRAINT uq_item_outlet_avail__outlet_prod_sku DO NOTHING
      `)
    })
  })

  return {
    tenantId,
    slug,
    actorUserId: actor.appUserId,
    outletAId,
    outletBId,
    outletCId,
    registerAId,
    registerBId,
    registerCId,
    pcsUomId: pcsId,
    dusUomId: dusId,
    categoryId: catId,
    deviceA: {
      tenantId,
      deviceId: enr.device_id,
      registerId: registerAId,
      outletId: outletAId,
      registerType: 'CASHIER',
    },
    seedDurationMs: Date.now() - startedAt,
    counts: {
      products: 1250,
      skus: 5000,
      skuUoms: 6000,
      availabilityOutletA: 5000,
      priceEntriesOutletAAndDefault: 10000,
    },
  }
}
