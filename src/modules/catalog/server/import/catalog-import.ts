import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { createLogger } from '~/server/log'
import type { ProductType } from '../../shared'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  type CatalogActor,
  type CatalogServiceDeps,
} from '../auth'
import {
  insertDefaultAvailabilityForProductsBatch,
  listActiveOutletIds,
} from '../availability.repo'
import { listCategories, upsertCategoryBatch, type CategoryRow } from '../category.repo'
import { CsvImportError, parseCsv } from '../csv/parse-csv'
import { getHasTransactionsPort } from '../ports'
import { listActivePriceEntriesBySkuIds, upsertPriceEntryBatch } from '../price.repo'
import { listProductsByCodes, upsertProductBatch } from '../product.repo'
import {
  hasNonBaseActiveSkuUomForProductAndUom,
  listActiveSkuUomsByBarcodes,
  listSkuUomsBySkuIds,
  upsertSkuUomBatch,
} from '../sku-uom.repo'
import { listUoms } from '../uom.repo'
import {
  insertAttributeValueBatch,
  insertProductAttributeBatch,
  insertSkuAttributeValueBatch,
  listAttributeValuesByAttributes,
  listProductAttributesByProductIds,
  listSkusByCodes,
  listSkusByProductIds,
  upsertSkuBatch,
} from '../variant.repo'
import { consumeImportPlan, storeImportPlan } from './plan-cache'
import {
  MAX_REPORTED_ROW_ERRORS,
  type CommitImportResult,
  type EntityDiffCounts,
  type ImportReport,
  type ImportRowErrorCode,
  type RowError,
} from './types'

const log = createLogger('catalog.import')

export type CatalogCsvCol =
  | 'kategori'
  | 'kode_produk'
  | 'nama_produk'
  | 'tipe'
  | 'uom_dasar'
  | 'kode_sku'
  | 'label_varian'
  | 'barcode'
  | 'harga_default'
  | 'pajak'
  | 'lacak_stok'
  | 'open_price'
  | 'aktif'

export const CATALOG_CSV_ALIASES: Readonly<Record<string, CatalogCsvCol>> = {
  kategori: 'kategori',
  category: 'kategori',
  kode_produk: 'kode_produk',
  product_code: 'kode_produk',
  nama_produk: 'nama_produk',
  product_name: 'nama_produk',
  tipe: 'tipe',
  type: 'tipe',
  product_type: 'tipe',
  uom_dasar: 'uom_dasar',
  base_uom: 'uom_dasar',
  kode_sku: 'kode_sku',
  sku_code: 'kode_sku',
  label_varian: 'label_varian',
  variant_label: 'label_varian',
  varian: 'label_varian',
  variant: 'label_varian',
  barcode: 'barcode',
  harga_default: 'harga_default',
  default_price: 'harga_default',
  harga: 'harga_default',
  pajak: 'pajak',
  taxable: 'pajak',
  lacak_stok: 'lacak_stok',
  track_stock: 'lacak_stok',
  open_price: 'open_price',
  harga_terbuka: 'open_price',
  aktif: 'aktif',
  active: 'aktif',
  is_active: 'aktif',
}

const PRODUCT_CODE_RE = /^[A-Za-z0-9\-_.]{1,30}$/
const SKU_CODE_RE = /^[A-Za-z0-9\-_.]{1,40}$/
const INTEGER_RE = /^-?\d+$/

export interface ValidatedCatalogCsvRow {
  rowNumber: number
  categorySegments: string[]
  productCode: string
  productName: string
  productType: ProductType
  baseUomCode: string
  skuCode: string
  variantLabel: string | null
  barcode: string | null
  defaultPrice: number | null
  taxable: boolean
  trackStock: boolean
  isOpenPrice: boolean
  isActive: boolean
}

export interface ErrorCollector {
  errors: RowError[]
  totalErrors: number
  push(row: number, column: string, code: ImportRowErrorCode, messageKey: string): void
}

export function createErrorCollector(): ErrorCollector {
  const errors: RowError[] = []
  let totalErrors = 0
  return {
    errors,
    get totalErrors() {
      return totalErrors
    },
    push(row, column, code, messageKey) {
      totalErrors += 1
      if (errors.length < MAX_REPORTED_ROW_ERRORS) {
        errors.push({ row, column, code, messageKey })
      }
    },
  }
}

function parseBoolYN(raw: string | undefined, defaultVal: boolean): boolean | null {
  if (!raw || raw.trim() === '') return defaultVal
  const upper = raw.trim().toUpperCase()
  if (upper === 'Y') return true
  if (upper === 'N') return false
  return null
}

/**
 * Pure row-level parser/validator for catalog CSV rows (structural + format checks).
 * Separated from DB lookups so unit tests can verify error tables cleanly without Postgres.
 */
export function parseAndValidateCatalogCsvRows(csvText: string): {
  warnings: string[]
  rows: ValidatedCatalogCsvRow[]
  errors: RowError[]
  totalErrors: number
} {
  let parsed: ReturnType<typeof parseCsv<CatalogCsvCol>>
  try {
    parsed = parseCsv<CatalogCsvCol>(csvText, {
      aliases: CATALOG_CSV_ALIASES,
      requiredColumns: ['kategori', 'kode_produk', 'nama_produk', 'uom_dasar'],
    })
  } catch (err) {
    if (err instanceof CsvImportError) {
      throw new AppError(
        err.code === 'LIMIT_EXCEEDED' ? 'VALIDATION_FAILED' : 'VALIDATION_FAILED',
        `${err.code}: ${err.message}`,
      )
    }
    throw err
  }

  const col = createErrorCollector()
  const rows: ValidatedCatalogCsvRow[] = []

  for (const rawRow of parsed.rows) {
    const c = rawRow.cells
    const rn = rawRow.rowNumber
    let rowOk = true

    const rawCat = c.kategori?.trim() ?? ''
    const categorySegments = rawCat
      .split('>')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (categorySegments.length === 0) {
      col.push(rn, 'kategori', 'REQUIRED', 'import.error.required')
      rowOk = false
    } else if (categorySegments.length > 2) {
      col.push(rn, 'kategori', 'CATEGORY_DEPTH', 'import.error.categoryDepth')
      rowOk = false
    } else if (categorySegments.some((s) => s.length > 80)) {
      col.push(rn, 'kategori', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }

    const productCode = c.kode_produk?.trim() ?? ''
    if (productCode.length === 0) {
      col.push(rn, 'kode_produk', 'REQUIRED', 'import.error.required')
      rowOk = false
    } else if (!PRODUCT_CODE_RE.test(productCode)) {
      col.push(rn, 'kode_produk', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }

    const productName = c.nama_produk?.trim() ?? ''
    if (productName.length === 0) {
      col.push(rn, 'nama_produk', 'REQUIRED', 'import.error.required')
      rowOk = false
    } else if (productName.length > 160) {
      col.push(rn, 'nama_produk', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }

    const rawType = c.tipe?.trim().toUpperCase() || 'RETAIL'
    if (rawType !== 'RETAIL' && rawType !== 'MENU_FNB') {
      col.push(rn, 'tipe', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }

    const baseUomCode = (c.uom_dasar?.trim() ?? '').toLowerCase()
    if (baseUomCode.length === 0) {
      col.push(rn, 'uom_dasar', 'REQUIRED', 'import.error.required')
      rowOk = false
    } else if (!/^[a-z0-9]{1,12}$/.test(baseUomCode)) {
      col.push(rn, 'uom_dasar', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }

    const rawVariant = c.label_varian?.trim() ?? ''
    const variantLabel = rawVariant.length > 0 ? rawVariant : null
    if (variantLabel !== null && variantLabel.length > 80) {
      col.push(rn, 'label_varian', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }

    let skuCode = c.kode_sku?.trim() ?? ''
    if (skuCode.length === 0) {
      if (variantLabel === null) {
        skuCode = productCode
      } else {
        col.push(rn, 'kode_sku', 'REQUIRED', 'import.error.required')
        rowOk = false
      }
    }
    if (skuCode.length > 0 && !SKU_CODE_RE.test(skuCode)) {
      col.push(rn, 'kode_sku', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }

    const rawBarcode = c.barcode?.trim() ?? ''
    const barcode = rawBarcode.length > 0 ? rawBarcode : null
    if (barcode !== null && barcode.length > 64) {
      col.push(rn, 'barcode', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }

    let defaultPrice: number | null = null
    const rawPrice = c.harga_default?.trim() ?? ''
    if (rawPrice.length > 0) {
      if (!INTEGER_RE.test(rawPrice)) {
        col.push(rn, 'harga_default', 'INVALID_FORMAT', 'import.error.invalidFormat')
        rowOk = false
      } else {
        const n = Number(rawPrice)
        if (!Number.isSafeInteger(n) || n < 0) {
          col.push(rn, 'harga_default', 'PRICE_RANGE', 'import.error.priceRange')
          rowOk = false
        } else {
          defaultPrice = n
        }
      }
    }

    const taxable = parseBoolYN(c.pajak, true)
    if (taxable === null) {
      col.push(rn, 'pajak', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }
    const trackStock = parseBoolYN(c.lacak_stok, true)
    if (trackStock === null) {
      col.push(rn, 'lacak_stok', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }
    const isOpenPrice = parseBoolYN(c.open_price, false)
    if (isOpenPrice === null) {
      col.push(rn, 'open_price', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }
    const isActive = parseBoolYN(c.aktif, true)
    if (isActive === null) {
      col.push(rn, 'aktif', 'INVALID_FORMAT', 'import.error.invalidFormat')
      rowOk = false
    }

    if (rowOk && taxable !== null && trackStock !== null && isOpenPrice !== null && isActive !== null) {
      rows.push({
        rowNumber: rn,
        categorySegments,
        productCode,
        productName,
        productType: rawType as ProductType,
        baseUomCode,
        skuCode,
        variantLabel,
        barcode,
        defaultPrice,
        taxable,
        trackStock,
        isOpenPrice,
        isActive,
      })
    }
  }

  return {
    warnings: parsed.warnings,
    rows,
    errors: col.errors,
    totalErrors: col.totalErrors,
  }
}

interface CatalogImportPlan {
  kind: 'catalog'
  fileName: string
  categoriesToWrite: Array<{
    id: string
    parentId: string | null
    name: string
    sortOrder: number
  }>
  productsToWrite: Array<{
    id: string
    categoryId: string
    code: string
    name: string
    productType: ProductType
    hasVariants: boolean
    baseUomId: string
    trackStock: boolean
    taxable: boolean
    isActive: boolean
    isOpenPrice: boolean
    sortOrder: number
  }>
  attributesToCreate: Array<{ id: string; productId: string; name: string; sortOrder: number }>
  attributeValuesToCreate: Array<{ id: string; attributeId: string; value: string; sortOrder: number }>
  skusToWrite: Array<{
    id: string
    productId: string
    skuCode: string
    variantLabel: string | null
    isDefault: boolean
    isActive: boolean
    sortOrder: number
  }>
  skuAttributeLinksToCreate: Array<{ id: string; skuId: string; attributeValueId: string }>
  skuUomsToWrite: Array<{
    id: string
    skuId: string
    uomId: string
    conversionFactor: string
    isBase: boolean
    barcode: string | null
  }>
  pricesToWrite: Array<{
    id: string
    skuId: string
    uomId: string
    outletId: null
    price: number
    currency: 'IDR'
  }>
  newProductIds: string[]
  activeOutletIds: string[]
  expectedNewProductCodes: string[]
  expectedNewSkuCodes: string[]
  summary: Record<string, EntityDiffCounts>
}

export async function previewCatalogImport(
  actor: CatalogActor,
  csvText: string,
  fileName: string,
  deps?: CatalogServiceDeps,
): Promise<ImportReport> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const structural = parseAndValidateCatalogCsvRows(csvText)

  const col = createErrorCollector()
  for (const e of structural.errors) {
    col.push(e.row, e.column, e.code, e.messageKey)
  }

  // Group parsed valid rows + intra-file uniqueness checks
  const seenSkuCodes = new Map<string, number>()
  const seenBarcodes = new Map<string, number>()
  const rowsByProduct = new Map<string, ValidatedCatalogCsvRow[]>()

  for (const row of structural.rows) {
    const prevSkuRow = seenSkuCodes.get(row.skuCode)
    if (prevSkuRow !== undefined) {
      col.push(row.rowNumber, 'kode_sku', 'DUPLICATE_SKU_CODE', 'import.error.duplicateSkuCode')
    } else {
      seenSkuCodes.set(row.skuCode, row.rowNumber)
    }

    if (row.barcode !== null) {
      const prevBcRow = seenBarcodes.get(row.barcode)
      if (prevBcRow !== undefined) {
        col.push(row.rowNumber, 'barcode', 'DUPLICATE_BARCODE', 'import.error.duplicateBarcode')
      } else {
        seenBarcodes.set(row.barcode, row.rowNumber)
      }
    }

    const list = rowsByProduct.get(row.productCode) ?? []
    list.push(row)
    rowsByProduct.set(row.productCode, list)
  }

  // Product-group consistency checks
  for (const [, pRows] of rowsByProduct) {
    const hasVar = pRows.length > 1 || pRows.some((r) => r.variantLabel !== null)
    const first = pRows[0]!
    for (const r of pRows) {
      if (hasVar && r.variantLabel === null) {
        col.push(r.rowNumber, 'label_varian', 'REQUIRED', 'import.error.variantLabelRequired')
      }
      if (
        r.productName !== first.productName ||
        r.baseUomCode !== first.baseUomCode ||
        r.productType !== first.productType ||
        r.categorySegments.join('>') !== first.categorySegments.join('>')
      ) {
        col.push(r.rowNumber, 'kode_produk', 'INVALID_FORMAT', 'import.error.inconsistentProductRow')
      }
    }
    if (pRows.length > 100) {
      col.push(pRows[100]!.rowNumber, 'kode_sku', 'VARIANT_LIMIT', 'import.error.variantLimit')
    }
  }

  const productCodes = Array.from(rowsByProduct.keys())
  const skuCodes = Array.from(seenSkuCodes.keys())
  const barcodes = Array.from(seenBarcodes.keys())

  const summary: Record<string, EntityDiffCounts> = {
    category: { create: 0, update: 0, unchanged: 0 },
    product: { create: 0, update: 0, unchanged: 0 },
    sku: { create: 0, update: 0, unchanged: 0 },
    sku_uom: { create: 0, update: 0, unchanged: 0 },
    price_entry: { create: 0, update: 0, unchanged: 0 },
    item_outlet_availability: { create: 0, update: 0, unchanged: 0 },
  }

  const dbSnapshot = await withTenantReadOnly(actor.tenantId, async (tx) => {
    const [
      existingCategories,
      existingUoms,
      existingProducts,
      existingSkusByCode,
      existingBarcodeRows,
      activeOutletIds,
    ] = await Promise.all([
      listCategories(tx, actor.tenantId),
      listUoms(tx, actor.tenantId),
      listProductsByCodes(tx, actor.tenantId, productCodes),
      listSkusByCodes(tx, actor.tenantId, skuCodes),
      listActiveSkuUomsByBarcodes(tx, actor.tenantId, barcodes),
      listActiveOutletIds(tx, actor.tenantId),
    ])

    const prodIds = existingProducts.map((p) => p.id)
    const [existingProductSkus, existingAttrs] = await Promise.all([
      listSkusByProductIds(tx, actor.tenantId, prodIds),
      listProductAttributesByProductIds(tx, actor.tenantId, prodIds),
    ])
    const allKnownSkuIds = Array.from(
      new Set([...existingSkusByCode.map((s) => s.id), ...existingProductSkus.map((s) => s.id)]),
    )
    const [existingAttrValues, existingSkuUoms, existingPrices] = await Promise.all([
      listAttributeValuesByAttributes(
        tx,
        actor.tenantId,
        existingAttrs.map((a) => a.id),
      ),
      listSkuUomsBySkuIds(tx, actor.tenantId, allKnownSkuIds),
      listActivePriceEntriesBySkuIds(tx, actor.tenantId, allKnownSkuIds),
    ])

    // Validate baseUomId changes against HasTransactionsPort and non-base UOMs
    const uomByCode = new Map(existingUoms.map((u) => [u.code.toLowerCase(), u]))
    const prodByCode = new Map(existingProducts.map((p) => [p.code, p]))
    const hasTransactionsPort = getHasTransactionsPort()

    for (const [code, pRows] of rowsByProduct) {
      const existingProd = prodByCode.get(code)
      const targetUom = uomByCode.get(pRows[0]!.baseUomCode)
      if (!targetUom) {
        for (const r of pRows) {
          col.push(r.rowNumber, 'uom_dasar', 'UNKNOWN_UOM', 'import.error.unknownUom')
        }
        continue
      }
      if (existingProd && existingProd.baseUomId !== targetUom.id) {
        if (await hasTransactionsPort.hasTransactions(existingProd.id, tx)) {
          col.push(pRows[0]!.rowNumber, 'uom_dasar', 'BASE_UOM_LOCKED', 'import.error.baseUomLocked')
        } else if (
          await hasNonBaseActiveSkuUomForProductAndUom(tx, actor.tenantId, existingProd.id, targetUom.id)
        ) {
          col.push(pRows[0]!.rowNumber, 'uom_dasar', 'BASE_UOM_LOCKED', 'import.error.baseUomLocked')
        }
      }
    }

    return {
      existingCategories,
      uomByCode,
      existingProducts,
      existingSkusByCode,
      existingProductSkus,
      existingAttrs,
      existingAttrValues,
      existingBarcodeRows,
      existingSkuUoms,
      existingPrices,
      activeOutletIds,
    }
  })

  // Category path resolution (root -> child, max depth 2)
  const rootCatByName = new Map<string, CategoryRow>()
  const childCatByKey = new Map<string, CategoryRow>()
  const catById = new Map<string, CategoryRow>()
  for (const cat of dbSnapshot.existingCategories) {
    catById.set(cat.id, cat)
  }
  for (const cat of dbSnapshot.existingCategories) {
    if (cat.parentId === null) {
      rootCatByName.set(cat.name.toLowerCase(), cat)
    } else {
      const parent = catById.get(cat.parentId)
      if (parent) {
        childCatByKey.set(`${parent.name.toLowerCase()}>${cat.name.toLowerCase()}`, cat)
      }
    }
  }

  let nextCatSort =
    dbSnapshot.existingCategories.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1
  const plannedNewCats = new Map<
    string,
    { id: string; parentId: string | null; name: string; sortOrder: number }
  >()
  const resolvedCatIdByRow = new Map<number, string>()

  const getOrPlanRootCat = (name: string, rowNum: number): string | null => {
    const key = name.toLowerCase()
    const existingRoot = rootCatByName.get(key)
    if (existingRoot) return existingRoot.id
    const planned = plannedNewCats.get(key)
    if (planned) return planned.id
    // Check if an active non-root category shares this name at root? Non-issue because DB uniqueness is per parent_id,
    // wait: if parent doesn't exist, we plan a root category cleanly!
    const created = { id: newIdFrom(deps), parentId: null, name, sortOrder: nextCatSort++ }
    plannedNewCats.set(key, created)
    void rowNum
    return created.id
  }

  for (const row of structural.rows) {
    const segs = row.categorySegments
    if (segs.length === 1) {
      const key = segs[0]!.toLowerCase()
      const existingRoot = rootCatByName.get(key)
      if (existingRoot) {
        resolvedCatIdByRow.set(row.rowNumber, existingRoot.id)
      } else {
        const planned = plannedNewCats.get(key)
        if (planned) {
          resolvedCatIdByRow.set(row.rowNumber, planned.id)
        } else {
          const id = getOrPlanRootCat(segs[0]!, row.rowNumber)!
          resolvedCatIdByRow.set(row.rowNumber, id)
        }
      }
    } else if (segs.length === 2) {
      const rootName = segs[0]!
      const childName = segs[1]!
      const fullKey = `${rootName.toLowerCase()}>${childName.toLowerCase()}`
      const existingChild = childCatByKey.get(fullKey)
      if (existingChild) {
        resolvedCatIdByRow.set(row.rowNumber, existingChild.id)
      } else {
        const plannedChild = plannedNewCats.get(fullKey)
        if (plannedChild) {
          resolvedCatIdByRow.set(row.rowNumber, plannedChild.id)
        } else {
          const parentId = getOrPlanRootCat(rootName, row.rowNumber)!
          const child = {
            id: newIdFrom(deps),
            parentId,
            name: childName,
            sortOrder: nextCatSort++,
          }
          plannedNewCats.set(fullKey, child)
          resolvedCatIdByRow.set(row.rowNumber, child.id)
        }
      }
    }
  }

  const touchedExistingCatIds = new Set<string>()
  for (const catId of resolvedCatIdByRow.values()) {
    if (catById.has(catId)) touchedExistingCatIds.add(catId)
  }
  summary.category = {
    create: plannedNewCats.size,
    update: 0,
    unchanged: touchedExistingCatIds.size,
  }

  // Index existing DB state
  const existingProdByCode = new Map(dbSnapshot.existingProducts.map((p) => [p.code, p]))
  const existingSkuByCode = new Map(dbSnapshot.existingSkusByCode.map((s) => [s.skuCode, s]))
  const existingSkusByProdId = new Map<string, typeof dbSnapshot.existingProductSkus>()
  for (const s of dbSnapshot.existingProductSkus) {
    const arr = existingSkusByProdId.get(s.productId) ?? []
    arr.push(s)
    existingSkusByProdId.set(s.productId, arr)
  }
  const existingBaseSkuUomBySkuId = new Map(
    dbSnapshot.existingSkuUoms.filter((u) => u.isBase).map((u) => [u.skuId, u]),
  )
  const existingDefaultPriceBySkuUom = new Map(
    dbSnapshot.existingPrices
      .filter((p) => p.outletId === null)
      .map((p) => [`${p.skuId}:${p.uomId}`, p]),
  )
  const existingBarcodeOwnerByValue = new Map(
    dbSnapshot.existingBarcodeRows.filter((b) => b.barcode !== null).map((b) => [b.barcode!, b]),
  )

  const productsToWrite: CatalogImportPlan['productsToWrite'] = []
  const attributesToCreate: CatalogImportPlan['attributesToCreate'] = []
  const attributeValuesToCreate: CatalogImportPlan['attributeValuesToCreate'] = []
  const skusToWrite: CatalogImportPlan['skusToWrite'] = []
  const skuAttributeLinksToCreate: CatalogImportPlan['skuAttributeLinksToCreate'] = []
  const skuUomsToWrite: CatalogImportPlan['skuUomsToWrite'] = []
  const pricesToWrite: CatalogImportPlan['pricesToWrite'] = []
  const newProductIds: string[] = []
  const expectedNewProductCodes: string[] = []
  const expectedNewSkuCodes: string[] = []

  const existingAttrByProdId = new Map(dbSnapshot.existingAttrs.map((a) => [a.productId, a]))
  const existingAttrValsByAttrId = new Map<string, Map<string, string>>()
  for (const av of dbSnapshot.existingAttrValues) {
    let m = existingAttrValsByAttrId.get(av.attributeId)
    if (!m) {
      m = new Map()
      existingAttrValsByAttrId.set(av.attributeId, m)
    }
    m.set(av.value.toLowerCase(), av.id)
  }

  let prodIdx = 0
  for (const [productCode, pRows] of rowsByProduct) {
    const first = pRows[0]!
    const uom = dbSnapshot.uomByCode.get(first.baseUomCode)
    const catId = resolvedCatIdByRow.get(first.rowNumber)
    if (!uom || !catId) continue

    const existingProd = existingProdByCode.get(productCode)
    const hasVariants = pRows.length > 1 || pRows.some((r) => r.variantLabel !== null)
    const productId = existingProd?.id ?? newIdFrom(deps)

    if (existingProd && existingProd.hasVariants !== hasVariants) {
      col.push(first.rowNumber, 'label_varian', 'VARIANT_LIMIT', 'import.error.variantModeMismatch')
      continue
    }

    if (!existingProd) {
      summary.product!.create += 1
      newProductIds.push(productId)
      expectedNewProductCodes.push(productCode)
      productsToWrite.push({
        id: productId,
        categoryId: catId,
        code: productCode,
        name: first.productName,
        productType: first.productType,
        hasVariants,
        baseUomId: uom.id,
        trackStock: first.trackStock,
        taxable: first.taxable,
        isActive: first.isActive,
        isOpenPrice: first.isOpenPrice,
        sortOrder: prodIdx,
      })
    } else {
      const sameProd =
        existingProd.categoryId === catId &&
        existingProd.name === first.productName &&
        existingProd.productType === first.productType &&
        existingProd.baseUomId === uom.id &&
        existingProd.trackStock === first.trackStock &&
        existingProd.taxable === first.taxable &&
        existingProd.isActive === first.isActive &&
        existingProd.isOpenPrice === first.isOpenPrice
      if (sameProd) {
        summary.product!.unchanged += 1
      } else {
        summary.product!.update += 1
        productsToWrite.push({
          id: productId,
          categoryId: catId,
          code: productCode,
          name: first.productName,
          productType: first.productType,
          hasVariants,
          baseUomId: uom.id,
          trackStock: first.trackStock,
          taxable: first.taxable,
          isActive: first.isActive,
          isOpenPrice: first.isOpenPrice,
          sortOrder: existingProd.sortOrder,
        })
      }
    }
    prodIdx += 1

    // Variant attribute ("Varian") setup if hasVariants
    let variantAttrId: string | null = null
    let variantValMap = new Map<string, string>()
    let nextValSort = 0
    if (hasVariants) {
      const existingAttr = existingAttrByProdId.get(productId)
      if (existingAttr) {
        variantAttrId = existingAttr.id
        variantValMap = existingAttrValsByAttrId.get(existingAttr.id) ?? new Map()
        nextValSort = variantValMap.size
      } else {
        variantAttrId = newIdFrom(deps)
        attributesToCreate.push({
          id: variantAttrId,
          productId,
          name: 'Varian',
          sortOrder: 0,
        })
      }
    }

    const existingProdSkus = existingSkusByProdId.get(productId) ?? []
    let newSkuCountForProd = 0

    for (let sIdx = 0; sIdx < pRows.length; sIdx += 1) {
      const row = pRows[sIdx]!
      const matchedSkuByCode = existingSkuByCode.get(row.skuCode)
      if (matchedSkuByCode && matchedSkuByCode.productId !== productId) {
        col.push(row.rowNumber, 'kode_sku', 'DUPLICATE_SKU_CODE', 'import.error.duplicateSkuCode')
        continue
      }

      const existingSku =
        matchedSkuByCode ??
        (!hasVariants && existingProd ? existingProdSkus.find((s) => s.isDefault) : undefined)

      const skuId = existingSku?.id ?? newIdFrom(deps)
      if (!existingSku) {
        newSkuCountForProd += 1
        summary.sku!.create += 1
        expectedNewSkuCodes.push(row.skuCode)
        skusToWrite.push({
          id: skuId,
          productId,
          skuCode: row.skuCode,
          variantLabel: hasVariants ? row.variantLabel : null,
          isDefault: !hasVariants,
          isActive: row.isActive,
          sortOrder: existingProdSkus.length + sIdx,
        })
        if (hasVariants && variantAttrId && row.variantLabel !== null) {
          const valKey = row.variantLabel.toLowerCase()
          let valId = variantValMap.get(valKey)
          if (!valId) {
            valId = newIdFrom(deps)
            variantValMap.set(valKey, valId)
            attributeValuesToCreate.push({
              id: valId,
              attributeId: variantAttrId,
              value: row.variantLabel,
              sortOrder: nextValSort++,
            })
          }
          skuAttributeLinksToCreate.push({
            id: newIdFrom(deps),
            skuId,
            attributeValueId: valId,
          })
        }
      } else {
        const sameSku =
          existingSku.skuCode === row.skuCode &&
          existingSku.variantLabel === (hasVariants ? row.variantLabel : null) &&
          existingSku.isActive === row.isActive
        if (sameSku) {
          summary.sku!.unchanged += 1
        } else {
          summary.sku!.update += 1
          skusToWrite.push({
            id: skuId,
            productId,
            skuCode: row.skuCode,
            variantLabel: hasVariants ? row.variantLabel : null,
            isDefault: existingSku.isDefault,
            isActive: row.isActive,
            sortOrder: existingSku.sortOrder,
          })
        }
      }

      // Base sku_uom barcode collision check against DB
      if (row.barcode !== null) {
        const existingBcOwner = existingBarcodeOwnerByValue.get(row.barcode)
        if (existingBcOwner && existingBcOwner.skuId !== skuId) {
          col.push(row.rowNumber, 'barcode', 'DUPLICATE_BARCODE', 'import.error.duplicateBarcode')
        }
      }

      const existingBaseUom = existingBaseSkuUomBySkuId.get(skuId)
      if (!existingBaseUom) {
        summary.sku_uom!.create += 1
        skuUomsToWrite.push({
          id: newIdFrom(deps),
          skuId,
          uomId: uom.id,
          conversionFactor: '1',
          isBase: true,
          barcode: row.barcode,
        })
      } else if (existingBaseUom.uomId !== uom.id || existingBaseUom.barcode !== row.barcode) {
        summary.sku_uom!.update += 1
        skuUomsToWrite.push({
          id: existingBaseUom.id,
          skuId,
          uomId: uom.id,
          conversionFactor: '1',
          isBase: true,
          barcode: row.barcode,
        })
      } else {
        summary.sku_uom!.unchanged += 1
      }

      if (row.defaultPrice !== null) {
        const existingPrice = existingDefaultPriceBySkuUom.get(`${skuId}:${uom.id}`)
        if (!existingPrice) {
          summary.price_entry!.create += 1
          pricesToWrite.push({
            id: newIdFrom(deps),
            skuId,
            uomId: uom.id,
            outletId: null,
            price: row.defaultPrice,
            currency: 'IDR',
          })
        } else if (existingPrice.price !== row.defaultPrice) {
          summary.price_entry!.update += 1
          pricesToWrite.push({
            id: existingPrice.id,
            skuId,
            uomId: uom.id,
            outletId: null,
            price: row.defaultPrice,
            currency: 'IDR',
          })
        } else {
          summary.price_entry!.unchanged += 1
        }
      }
    }

    if (hasVariants && existingProdSkus.length + newSkuCountForProd > 100) {
      col.push(first.rowNumber, 'kode_sku', 'VARIANT_LIMIT', 'import.error.variantLimit')
    }
  }

  summary.item_outlet_availability = {
    create: newProductIds.length * dbSnapshot.activeOutletIds.length,
    update: 0,
    unchanged: 0,
  }

  if (col.totalErrors > 0) {
    return {
      valid: false,
      warnings: structural.warnings,
      errors: col.errors,
      totalErrors: col.totalErrors,
      summary,
    }
  }

  const token = newIdFrom(deps)
  const plan: CatalogImportPlan = {
    kind: 'catalog',
    fileName,
    categoriesToWrite: Array.from(plannedNewCats.values()),
    productsToWrite,
    attributesToCreate,
    attributeValuesToCreate,
    skusToWrite,
    skuAttributeLinksToCreate,
    skuUomsToWrite,
    pricesToWrite,
    newProductIds,
    activeOutletIds: dbSnapshot.activeOutletIds,
    expectedNewProductCodes,
    expectedNewSkuCodes,
    summary,
  }

  storeImportPlan({
    token,
    tenantId: actor.tenantId,
    userId: actor.appUserId,
    kind: 'catalog',
    plan,
    nowMs: Date.parse(nowIsoFrom(deps)),
  })

  return {
    valid: true,
    token,
    warnings: structural.warnings,
    errors: [],
    totalErrors: 0,
    summary,
  }
}

export async function commitCatalogImport(
  actor: CatalogActor,
  rawToken: string,
  deps?: CatalogServiceDeps,
): Promise<CommitImportResult> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const tokenRes = z.string().min(1).safeParse(rawToken)
  if (!tokenRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid import token')
  }

  const nowIso = nowIsoFrom(deps)
  const plan = consumeImportPlan<CatalogImportPlan>({
    token: tokenRes.data,
    tenantId: actor.tenantId,
    userId: actor.appUserId,
    kind: 'catalog',
    nowMs: Date.parse(nowIso),
  })

  const created = Object.fromEntries(
    Object.entries(plan.summary).map(([k, v]) => [k, v.create]),
  )
  const updated = Object.fromEntries(
    Object.entries(plan.summary).map(([k, v]) => [k, v.update]),
  )
  const unchanged = Object.fromEntries(
    Object.entries(plan.summary).map(([k, v]) => [k, v.unchanged]),
  )

  const totalMutations =
    plan.categoriesToWrite.length +
    plan.productsToWrite.length +
    plan.skusToWrite.length +
    plan.skuUomsToWrite.length +
    plan.pricesToWrite.length

  if (totalMutations === 0) {
    return { version: null, versionBumped: false, created, updated, unchanged }
  }

  const version = await withTenant(actor.tenantId, async (tx) => {
    // Fast re-validation against concurrent changes between preview and commit
    const [concurrentProds, concurrentSkus, concurrentBarcodes] = await Promise.all([
      listProductsByCodes(tx, actor.tenantId, plan.expectedNewProductCodes),
      listSkusByCodes(tx, actor.tenantId, plan.expectedNewSkuCodes),
      listActiveSkuUomsByBarcodes(
        tx,
        actor.tenantId,
        plan.skuUomsToWrite.map((u) => u.barcode).filter((b): b is string => b !== null),
      ),
    ])

    if (concurrentProds.length > 0 || concurrentSkus.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Data changed since preview; please run preview again')
    }
    const plannedBarcodeOwner = new Map(
      plan.skuUomsToWrite.filter((u) => u.barcode !== null).map((u) => [u.barcode!, u.skuId]),
    )
    for (const bcRow of concurrentBarcodes) {
      const targetSkuId = bcRow.barcode ? plannedBarcodeOwner.get(bcRow.barcode) : undefined
      if (targetSkuId && bcRow.skuId !== targetSkuId) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Data changed since preview (barcode conflict); please run preview again',
        )
      }
    }

    const { version: nextVersion } = await writeMaster(
      tx,
      { actorUserId: actor.appUserId },
      async (w) => {
        const rootCats = plan.categoriesToWrite.filter((c) => c.parentId === null)
        const childCats = plan.categoriesToWrite.filter((c) => c.parentId !== null)
        if (rootCats.length > 0) {
          await upsertCategoryBatch(
            tx,
            w,
            rootCats.map((c) => ({ ...c, nowIso })),
          )
        }
        if (childCats.length > 0) {
          await upsertCategoryBatch(
            tx,
            w,
            childCats.map((c) => ({ ...c, nowIso })),
          )
        }

        if (plan.productsToWrite.length > 0) {
          await upsertProductBatch(
            tx,
            w,
            plan.productsToWrite.map((p) => ({ ...p, nowIso })),
          )
        }

        if (plan.attributesToCreate.length > 0) {
          await insertProductAttributeBatch(
            tx,
            w.tenantId,
            w.actorUserId,
            plan.attributesToCreate.map((a) => ({ ...a, nowIso })),
          )
        }
        if (plan.attributeValuesToCreate.length > 0) {
          await insertAttributeValueBatch(
            tx,
            w.tenantId,
            w.actorUserId,
            plan.attributeValuesToCreate.map((v) => ({ ...v, nowIso })),
          )
        }

        if (plan.skusToWrite.length > 0) {
          await upsertSkuBatch(
            tx,
            w,
            plan.skusToWrite.map((s) => ({ ...s, nowIso })),
          )
        }

        if (plan.skuAttributeLinksToCreate.length > 0) {
          await insertSkuAttributeValueBatch(
            tx,
            w.tenantId,
            w.actorUserId,
            plan.skuAttributeLinksToCreate.map((l) => ({ ...l, nowIso })),
          )
        }

        if (plan.skuUomsToWrite.length > 0) {
          await upsertSkuUomBatch(
            tx,
            w,
            plan.skuUomsToWrite.map((u) => ({ ...u, nowIso })),
          )
        }

        if (plan.pricesToWrite.length > 0) {
          await upsertPriceEntryBatch(
            tx,
            w,
            plan.pricesToWrite.map((p) => ({ ...p, nowIso })),
          )
        }

        if (plan.newProductIds.length > 0 && plan.activeOutletIds.length > 0) {
          await insertDefaultAvailabilityForProductsBatch(
            tx,
            w,
            plan.newProductIds,
            plan.activeOutletIds,
            nowIso,
          )
        }
      },
    )

    log.info(
      {
        tenantId: actor.tenantId,
        userId: actor.appUserId,
        fn: 'commitCatalogImport',
        label: plan.fileName,
        rowCount: plan.productsToWrite.length + plan.skusToWrite.length,
      },
      'Committed bulk catalog CSV import',
    )

    return nextVersion
  })

  return { version, versionBumped: true, created, updated, unchanged }
}
