import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  __clearHasTransactionsPortForTests,
  __clearImportPlansForTests,
  type CatalogActor,
  commitAvailabilityImport,
  commitCatalogImport,
  commitPriceImport,
  createUom,
  exportCatalogCsv,
  previewAvailabilityImport,
  previewCatalogImport,
  previewPriceImport,
  registerHasTransactionsPort,
} from '~/modules/catalog/public'
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
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { pullPage, startPullCycle, type SyncDeviceIdentity } from '~/modules/sync/public'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'
import { uniqueSlug, withTestTenant } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const testOp = { platformUserId: testIdGen.newId(), email: 'op-cat-imp@example.test' }

async function setupImportFixture(prefix: string) {
  const slug = uniqueSlug(prefix)
  const created = await createTenant(testOp, {
    name: `Imp ${slug}`,
    slug,
    ownerEmail: `owner-${slug}@example.test`,
    ownerDisplayName: 'Owner',
  })
  const meta = await getTenantAuthMetadataBySlug(slug)
  const idActor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }
  const owner: CatalogActor = {
    tenantId: created.tenantId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(['catalog.manage']),
    outletIds: null,
  }

  const le = await createLegalEntity(idActor, { name: 'PT Import', isPkp: false })
  const outletA = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUTA',
    name: 'Outlet A',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })
  const outletB = await createOutlet(idActor, {
    legalEntityId: le.id,
    code: 'OUTB',
    name: 'Outlet B',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
  })

  const reg = await createRegister(idActor, {
    outletId: outletA.id,
    code: 'POS01',
    name: 'Register A',
    registerType: 'CASHIER',
    invoicePrefix: 'OUTA-POS01',
  })
  const pair = await createPairingCode(idActor, reg.id)
  const enr = await enrollDevice({ slug, code: pair.code, device_name: 'Dev-A' }, '10.10.0.1', {
    minDelayMs: 0,
  })
  const deviceA: SyncDeviceIdentity = {
    tenantId: created.tenantId,
    deviceId: enr.device_id,
    registerId: reg.id,
    outletId: outletA.id,
    registerType: 'CASHIER',
  }

  const pcs = await createUom(owner, { code: 'pcs', name: 'Pieces' })
  const dus = await createUom(owner, { code: 'dus', name: 'Dus' })

  return { tenantId: created.tenantId, owner, outletA, outletB, deviceA, pcs, dus }
}

async function getTenantVersion(tenantId: string): Promise<number> {
  return withTestTenant(tenantId, async (tx) => {
    const res = await tx.execute(
      sql`SELECT version FROM tenant_sync WHERE tenant_id = ${tenantId}::uuid`,
    )
    return Number((res.rows[0] as { version: string | number }).version)
  })
}

function build4000SkuCsv(): string {
  const lines = [
    'kategori,kode_produk,nama_produk,tipe,uom_dasar,kode_sku,label_varian,barcode,harga_default,pajak,lacak_stok,open_price,aktif',
  ]
  for (let p = 1; p <= 1000; p += 1) {
    const prodCode = `P-${String(p).padStart(4, '0')}`
    for (let v = 1; v <= 4; v += 1) {
      const skuCode = `${prodCode}-V${v}`
      const barcode = `899${String(p).padStart(4, '0')}${v}`
      lines.push(
        `Umum > Grup${(p % 5) + 1},${prodCode},Produk ${p},RETAIL,pcs,${skuCode},Var ${v},${barcode},${10000 + v * 1000},Y,Y,N,Y`,
      )
    }
  }
  return lines.join('\n')
}

describe('catalog-import integration (two-stage preview/commit, single-version, export round-trip)', () => {
  beforeEach(() => {
    resetCompositionForTests()
    composeServer()
    resetLimitersForTests()
    __clearDeviceAuthCacheForTests()
    __clearTenantCacheForTests()
    __clearImportPlansForTests()
  })

  afterEach(() => {
    resetCompositionForTests()
    __clearImportPlansForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('imports 4,000 SKUs (1,000 products x 4 variants) in 1 version < 15s, seeds availability, and streams in one pull cycle (cases 1, 2, 5, 12)', { timeout: 60_000 }, async () => {
    const fx = await setupImportFixture('cimp4k')
    const csv4k = build4000SkuCsv()

    const vBefore = await getTenantVersion(fx.tenantId)
    const preview = await previewCatalogImport(fx.owner, csv4k, 'catalog-4000.csv')
    expect(preview.valid).toBe(true)
    expect(preview.errors).toHaveLength(0)
    expect(preview.summary.product).toEqual({ create: 1000, update: 0, unchanged: 0 })
    expect(preview.summary.sku).toEqual({ create: 4000, update: 0, unchanged: 0 })
    expect(preview.summary.item_outlet_availability).toEqual({ create: 2000, update: 0, unchanged: 0 })

    const t0 = Date.now()
    const committed = await commitCatalogImport(fx.owner, preview.token!)
    const commitMs = Date.now() - t0
    const vAfter = await getTenantVersion(fx.tenantId)

    expect(commitMs).toBeLessThan(15_000)
    expect(committed.versionBumped).toBe(true)
    expect(committed.version).toBe(vBefore + 1)
    expect(vAfter).toBe(vBefore + 1)

    // Verify all imported rows share the exact single version
    await withTestTenant(fx.tenantId, async (tx) => {
      for (const table of ['product', 'sku', 'sku_uom', 'price_entry', 'item_outlet_availability']) {
        const res = await tx.execute(
          sql.raw(
            `SELECT count(DISTINCT version)::int AS dv, min(version)::bigint AS mv FROM "${table}"`,
          ),
        )
        const row = res.rows[0] as { dv: number; mv: number }
        expect(row.dv, `Expected 1 distinct version in ${table}`).toBe(1)
        expect(row.mv, `Expected committed version in ${table}`).toBe(committed.version)
      }
      const availCnt = await tx.execute(sql`SELECT count(*)::int AS c FROM item_outlet_availability`)
      expect((availCnt.rows[0] as { c: number }).c).toBe(2000)
    })

    // Case 5: re-importing identical 4,000-row CSV produces unchanged & versionBumped: false
    const previewSame = await previewCatalogImport(fx.owner, csv4k, 'catalog-4000.csv')
    expect(previewSame.valid).toBe(true)
    expect(previewSame.summary.product).toEqual({ create: 0, update: 0, unchanged: 1000 })
    expect(previewSame.summary.sku).toEqual({ create: 0, update: 0, unchanged: 4000 })
    const commitSame = await commitCatalogImport(fx.owner, previewSame.token!)
    expect(commitSame.versionBumped).toBe(false)
    expect(await getTenantVersion(fx.tenantId)).toBe(vAfter)

    // Case 12: device pulls imported rows within single cycle (upper = committed.version)
    const cycle = await startPullCycle(fx.tenantId)
    expect(cycle.upper).toBe(committed.version)
    let cursor = null
    let pulledProducts = 0
    let pulledSkus = 0
    while (true) {
      const page = await pullPage({
        tenantId: fx.tenantId,
        scope: {
          tenantId: fx.tenantId,
          outletId: fx.outletA.id,
          registerId: fx.deviceA.registerId,
          deviceId: fx.deviceA.deviceId,
        },
        cursor,
        cycleUpper: cycle.upper,
        pageSize: 500,
      })
      if (page.fullResyncRequired) throw new Error('unexpected full resync')
      pulledProducts += page.rows.filter((r) => r.entity === 'product').length
      pulledSkus += page.rows.filter((r) => r.entity === 'sku').length
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    expect(pulledProducts).toBe(1000)
    expect(pulledSkus).toBe(4000)
  })

  it('enforces all-or-nothing validation, duplicate barcodes, upserts, >5000 limit, token ownership & staleness, and round-trip formula-safe export (cases 3, 4, 6, 7, 9, 11, 12)', async () => {
    const fx = await setupImportFixture('cimpcore')

    // Case 3: all-or-nothing (1 bad row among valid fixture rows -> valid:false, zero DB changes)
    const invalidCsv = readFileSync(resolve('tests/fixtures/csv/catalog-invalid.csv'), 'utf8')
    const invalidReport = await previewCatalogImport(fx.owner, invalidCsv, 'catalog-invalid.csv')
    expect(invalidReport.valid).toBe(false)
    expect(invalidReport.token).toBeUndefined()
    expect(invalidReport.errors.some((e) => e.row === 2 && e.code === 'CATEGORY_DEPTH')).toBe(true)
    expect(invalidReport.errors.some((e) => e.row === 3 && e.code === 'UNKNOWN_UOM')).toBe(true)
    expect(invalidReport.errors.some((e) => e.row === 4 && e.code === 'PRICE_RANGE')).toBe(true)

    // Case 4a: duplicate barcode within same CSV
    const dupInFileCsv = [
      'kategori,kode_produk,nama_produk,uom_dasar,kode_sku,barcode',
      'Minuman,P-A,Produk A,pcs,P-A,8999999',
      'Minuman,P-B,Produk B,pcs,P-B,8999999',
    ].join('\n')
    const dupInFileReport = await previewCatalogImport(fx.owner, dupInFileCsv, 'dup.csv')
    expect(dupInFileReport.valid).toBe(false)
    expect(dupInFileReport.errors.some((e) => e.row === 3 && e.code === 'DUPLICATE_BARCODE')).toBe(true)

    // Seed valid fixture + formula product name
    const validCsv = readFileSync(resolve('tests/fixtures/csv/catalog-valid.csv'), 'utf8')
    const p1 = await previewCatalogImport(fx.owner, validCsv, 'catalog-valid.csv')
    expect(p1.valid).toBe(true)
    await commitCatalogImport(fx.owner, p1.token!)

    // Case 4b: duplicate barcode against existing DB
    const dupDbCsv = [
      'kategori,kode_produk,nama_produk,uom_dasar,kode_sku,barcode',
      'Minuman,P-C,Produk C,pcs,P-C,8991002001',
    ].join('\n')
    const dupDbReport = await previewCatalogImport(fx.owner, dupDbCsv, 'dup-db.csv')
    expect(dupDbReport.valid).toBe(false)
    expect(dupDbReport.errors[0]).toMatchObject({
      row: 2,
      column: 'barcode',
      code: 'DUPLICATE_BARCODE',
    })

    // Case 6: upsert name & price on Snack SN-200 + add formula-prefixed product name for Case 11
    const upsertCsv = [
      'kategori,kode_produk,nama_produk,tipe,uom_dasar,kode_sku,label_varian,barcode,harga_default,pajak,lacak_stok,open_price,aktif',
      'Minuman > Kopi,KP-100,Kopi Aren,MENU_FNB,pcs,KP-100-REG,Reguler,8991001001,18000,Y,Y,N,Y',
      'Minuman > Kopi,KP-100,Kopi Aren,MENU_FNB,pcs,KP-100-LRG,Large,8991001002,24000,Y,Y,N,Y',
      'Snack,SN-200,=Keripik Baru,RETAIL,pcs,SN-200,,8991002001,13500,Y,Y,N,Y',
    ].join('\n')
    const pUpsert = await previewCatalogImport(fx.owner, upsertCsv, 'upsert.csv')
    expect(pUpsert.valid).toBe(true)
    expect(pUpsert.summary.product).toEqual({ create: 0, update: 1, unchanged: 1 })
    expect(pUpsert.summary.price_entry).toEqual({ create: 0, update: 1, unchanged: 2 })
    await commitCatalogImport(fx.owner, pUpsert.token!)

    // Case 11: exportCsv prefixes `=Keripik Baru` as `'=Keripik Baru` and round-trips to unchanged
    const exported = await exportCatalogCsv(fx.owner)
    expect(exported).toContain("'=Keripik Baru")
    const roundTrip = await previewCatalogImport(fx.owner, exported, 'roundtrip.csv')
    expect(roundTrip.valid).toBe(true)
    expect(roundTrip.summary.product).toEqual({ create: 0, update: 0, unchanged: 2 })
    expect(roundTrip.summary.sku).toEqual({ create: 0, update: 0, unchanged: 3 })
    const rtCommit = await commitCatalogImport(fx.owner, roundTrip.token!)
    expect(rtCommit.versionBumped).toBe(false)

    // Case 9a: other user cannot commit another user's preview token; expired token rejected
    const pTokenTest = await previewCatalogImport(
      fx.owner,
      'kategori,kode_produk,nama_produk,uom_dasar,harga_default\nSnack,SN-9,New,pcs,5000',
      'tok.csv',
    )
    const otherUser: CatalogActor = { ...fx.owner, appUserId: testIdGen.newId() }
    await expect(commitCatalogImport(otherUser, pTokenTest.token!)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      commitCatalogImport(fx.owner, pTokenTest.token!, {
        nowIso: () => new Date(Date.now() + 20 * 60_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    // Case 9b: concurrent modification between preview and commit aborts cleanly
    const pStale = await previewCatalogImport(
      fx.owner,
      'kategori,kode_produk,nama_produk,uom_dasar,barcode\nSnack,SN-RACE,Race Prod,pcs,899555555',
      'race.csv',
    )
    const pWinner = await previewCatalogImport(
      fx.owner,
      'kategori,kode_produk,nama_produk,uom_dasar,barcode\nSnack,SN-RACE,Race Winner,pcs,899555555',
      'winner.csv',
    )
    await commitCatalogImport(fx.owner, pWinner.token!)
    await expect(commitCatalogImport(fx.owner, pStale.token!)).rejects.toThrow(/Data changed/)

    // Case 12b: > 5,000 rows rejected cleanly
    const tooBig = ['kategori,kode_produk,nama_produk,uom_dasar']
    for (let i = 1; i <= 5001; i += 1) tooBig.push(`Umum,OVER-${i},Item ${i},pcs`)
    await expect(previewCatalogImport(fx.owner, tooBig.join('\n'), 'big.csv')).rejects.toThrow(
      /LIMIT_EXCEEDED/,
    )

    // Also test BASE_UOM_LOCKED when base UOM changed for a transacted product
    __clearHasTransactionsPortForTests()
    registerHasTransactionsPort({ hasTransactions: async () => true })
    const baseChangeReport = await previewCatalogImport(
      fx.owner,
      'kategori,kode_produk,nama_produk,uom_dasar,kode_sku\nSnack,SN-200,=Keripik Baru,dus,SN-200',
      'uom-locked.csv',
    )
    expect(baseChangeReport.valid).toBe(false)
    expect(baseChangeReport.errors[0]!.code).toBe('BASE_UOM_LOCKED')
  })

  it('imports 4,000 price rows in 1 version, 500 availability rows in 1 version, and blocks Manager out-of-scope outlets (cases 8, 10)', async () => {
    const fx = await setupImportFixture('cimpprice')
    const basePreview = await previewCatalogImport(fx.owner, build4000SkuCsv(), 'base4k.csv')
    await commitCatalogImport(fx.owner, basePreview.token!)

    // Case 8: Manager scoped to Outlet A cannot import default or Outlet B prices/availability
    const managerA: CatalogActor = {
      tenantId: fx.tenantId,
      appUserId: fx.owner.appUserId,
      permissions: new Set(['catalog.manage']),
      outletIds: [fx.outletA.id],
    }

    const mgrBadPrice = await previewPriceImport(
      managerA,
      'kode_sku,uom,outlet,harga\nP-0001-V1,pcs,,15000\nP-0001-V2,pcs,OUTB,16000',
      'mgr-price.csv',
    )
    expect(mgrBadPrice.valid).toBe(false)
    expect(mgrBadPrice.errors).toHaveLength(2)
    expect(mgrBadPrice.errors.every((e) => e.code === 'OUTLET_OUT_OF_SCOPE')).toBe(true)

    const mgrBadAvail = await previewAvailabilityImport(
      managerA,
      'kode_produk,outlet,status\nP-0001,OUTB,UNAVAILABLE',
      'mgr-avail.csv',
    )
    expect(mgrBadAvail.valid).toBe(false)
    expect(mgrBadAvail.errors[0]!.code).toBe('OUTLET_OUT_OF_SCOPE')

    // Case 10a: 4,000 outlet A price rows = 1 version bump
    const priceLines = ['kode_sku,uom,outlet,harga']
    for (let p = 1; p <= 1000; p += 1) {
      for (let v = 1; v <= 4; v += 1) {
        priceLines.push(`P-${String(p).padStart(4, '0')}-V${v},pcs,OUTA,${19000 + v * 500}`)
      }
    }
    const vBeforePrice = await getTenantVersion(fx.tenantId)
    const pricePreview = await previewPriceImport(managerA, priceLines.join('\n'), 'price-4000.csv')
    expect(pricePreview.valid).toBe(true)
    expect(pricePreview.summary.price_entry).toEqual({ create: 4000, update: 0, unchanged: 0 })
    const priceCommit = await commitPriceImport(managerA, pricePreview.token!)
    expect(priceCommit.version).toBe(vBeforePrice + 1)

    // Case 10b: 500 availability rows (product + SKU override) = 1 version bump
    const availLines = ['kode_produk,outlet,status,kode_sku']
    for (let p = 1; p <= 500; p += 1) {
      const code = `P-${String(p).padStart(4, '0')}`
      availLines.push(`${code},OUTA,UNAVAILABLE,${p <= 250 ? '' : `${code}-V1`}`)
    }
    const vBeforeAvail = await getTenantVersion(fx.tenantId)
    const availPreview = await previewAvailabilityImport(
      managerA,
      availLines.join('\n'),
      'avail-500.csv',
    )
    expect(availPreview.valid).toBe(true)
    const availCommit = await commitAvailabilityImport(managerA, availPreview.token!)
    expect(availCommit.version).toBe(vBeforeAvail + 1)
  })
})
