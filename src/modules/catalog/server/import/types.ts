export type ImportKind = 'catalog' | 'price' | 'availability'

export type ImportRowErrorCode =
  | 'REQUIRED'
  | 'INVALID_FORMAT'
  | 'UNKNOWN_UOM'
  | 'UNKNOWN_OUTLET'
  | 'UNKNOWN_SKU'
  | 'UNKNOWN_PRODUCT'
  | 'DUPLICATE_BARCODE'
  | 'DUPLICATE_SKU_CODE'
  | 'CATEGORY_DEPTH'
  | 'VARIANT_LIMIT'
  | 'BASE_UOM_LOCKED'
  | 'PRICE_RANGE'
  | 'OUTLET_OUT_OF_SCOPE'

export interface RowError {
  row: number
  column: string
  code: ImportRowErrorCode
  messageKey: string
}

export interface EntityDiffCounts {
  create: number
  update: number
  unchanged: number
  deactivate?: number
}

export interface ImportReport {
  valid: boolean
  token?: string
  warnings: string[]
  errors: RowError[]
  totalErrors: number
  summary: Record<string, EntityDiffCounts>
}

export interface CommitImportResult {
  version: number | null
  versionBumped: boolean
  created: Record<string, number>
  updated: Record<string, number>
  unchanged: Record<string, number>
}

export const MAX_REPORTED_ROW_ERRORS = 200
