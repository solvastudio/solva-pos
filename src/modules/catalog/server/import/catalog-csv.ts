import '@tanstack/react-start/server-only'
import { AppError } from '~/server/error-classify'
import type { ProductType } from '../../shared'
import { CsvImportError, parseCsv } from '../csv/parse-csv'
import { MAX_REPORTED_ROW_ERRORS, type ImportRowErrorCode, type RowError } from './types'

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
