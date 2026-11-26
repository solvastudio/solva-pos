import '@tanstack/react-start/server-only'
import { withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { requireCatalogPermission, type CatalogActor } from './auth'
import { listActiveOutletsWithCodes } from './availability.repo'
import { listCategories } from './category.repo'
import { toCsv } from './csv/csv-safe'
import { listActivePriceEntriesBySkuIds } from './price.repo'
import { listProducts } from './product.repo'
import { listSkuUomsBySkuIds } from './sku-uom.repo'
import { listUoms } from './uom.repo'
import { listAllActiveSkus } from './variant.repo'

const MAX_EXPORT_ROWS = 20_000

const BASE_EXPORT_HEADERS = [
  'kategori',
  'kode_produk',
  'nama_produk',
  'tipe',
  'uom_dasar',
  'kode_sku',
  'label_varian',
  'barcode',
  'harga_default',
  'pajak',
  'lacak_stok',
  'open_price',
  'aktif',
] as const

export interface ExportCatalogCsvOptions {
  outletCode?: string
}

/**
 * Exports active tenant catalog rows (one row per SKU, capped at 20,000 rows) as a formula-safe
 * CSV formatted identically to the Catalog Import schema for lossless round-trip editing.
 */
export async function exportCatalogCsv(
  actor: CatalogActor,
  opts?: ExportCatalogCsvOptions,
): Promise<string> {
  const cleanOutletCode = opts?.outletCode?.trim()
  requireCatalogPermission(actor, cleanOutletCode ? undefined : { requireTenantWide: true })

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    let targetOutletId: string | null = null
    if (cleanOutletCode) {
      const outlets = await listActiveOutletsWithCodes(tx, actor.tenantId)
      const matched = outlets.find((o) => o.code.toLowerCase() === cleanOutletCode.toLowerCase())
      if (!matched) {
        throw new AppError('VALIDATION_FAILED', `Outlet not found: ${cleanOutletCode}`)
      }
      requireCatalogPermission(actor, { outletId: matched.id })
      targetOutletId = matched.id
    }

    // Sequential on purpose: all queries share this transaction's single connection.
    const categories = await listCategories(tx, actor.tenantId)
    const uoms = await listUoms(tx, actor.tenantId)
    const products = await listProducts(tx, actor.tenantId)
    const skus = await listAllActiveSkus(tx, actor.tenantId, MAX_EXPORT_ROWS)

    const skuIds = skus.map((s) => s.id)
    const skuUoms = await listSkuUomsBySkuIds(tx, actor.tenantId, skuIds)
    const prices = await listActivePriceEntriesBySkuIds(tx, actor.tenantId, skuIds)

    const catById = new Map(categories.map((c) => [c.id, c]))
    const uomById = new Map(uoms.map((u) => [u.id, u]))
    const productById = new Map(products.map((p) => [p.id, p]))
    const baseSkuUomBySkuId = new Map(skuUoms.filter((su) => su.isBase).map((su) => [su.skuId, su]))

    const defaultPriceByKey = new Map<string, number>()
    const outletPriceByKey = new Map<string, number>()
    for (const p of prices) {
      if (p.outletId === null) {
        defaultPriceByKey.set(`${p.skuId}:${p.uomId}`, p.price)
      } else if (targetOutletId !== null && p.outletId === targetOutletId) {
        outletPriceByKey.set(`${p.skuId}:${p.uomId}`, p.price)
      }
    }

    const headers: string[] = targetOutletId
      ? [...BASE_EXPORT_HEADERS, 'harga_outlet']
      : [...BASE_EXPORT_HEADERS]

    const rows: Array<Array<string | number | null>> = []
    for (const skuRow of skus) {
      const prod = productById.get(skuRow.productId)
      if (!prod) continue
      const cat = catById.get(prod.categoryId)
      const parentCat = cat?.parentId ? catById.get(cat.parentId) : undefined
      const categoryPath = cat ? (parentCat ? `${parentCat.name} > ${cat.name}` : cat.name) : ''
      const uom = uomById.get(prod.baseUomId)
      const baseSkuUom = baseSkuUomBySkuId.get(skuRow.id)
      const defPrice = defaultPriceByKey.get(`${skuRow.id}:${prod.baseUomId}`) ?? null

      const baseCells: Array<string | number | null> = [
        categoryPath,
        prod.code,
        prod.name,
        prod.productType,
        uom?.code ?? '',
        skuRow.skuCode,
        skuRow.variantLabel ?? '',
        baseSkuUom?.barcode ?? '',
        defPrice,
        prod.taxable ? 'Y' : 'N',
        prod.trackStock ? 'Y' : 'N',
        prod.isOpenPrice ? 'Y' : 'N',
        prod.isActive && skuRow.isActive ? 'Y' : 'N',
      ]

      if (targetOutletId) {
        const outPrice = outletPriceByKey.get(`${skuRow.id}:${prod.baseUomId}`) ?? null
        baseCells.push(outPrice)
      }
      rows.push(baseCells)
    }

    return toCsv(rows, headers)
  })
}
