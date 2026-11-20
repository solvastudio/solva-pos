import type {
  AvailabilityProductLike,
  AvailabilityRow,
  AvailabilitySkuLike,
} from './availability'

export const KAOS_PRODUCT_ID = 'prod-kaos-polos'

export const KAOS_INITIAL_SKUS: readonly (AvailabilitySkuLike & { code: string })[] = [
  { id: 'sku-s-mer', productId: KAOS_PRODUCT_ID, code: 'S-MER', isActive: true },
  { id: 'sku-s-htm', productId: KAOS_PRODUCT_ID, code: 'S-HTM', isActive: true },
  { id: 'sku-m-mer', productId: KAOS_PRODUCT_ID, code: 'M-MER', isActive: true },
  { id: 'sku-m-htm', productId: KAOS_PRODUCT_ID, code: 'M-HTM', isActive: true },
  { id: 'sku-l-mer', productId: KAOS_PRODUCT_ID, code: 'L-MER', isActive: true },
  { id: 'sku-l-htm', productId: KAOS_PRODUCT_ID, code: 'L-HTM', isActive: true },
]

export const KAOS_WITH_XL_SKUS: readonly (AvailabilitySkuLike & { code: string })[] = [
  ...KAOS_INITIAL_SKUS,
  { id: 'sku-xl-mer', productId: KAOS_PRODUCT_ID, code: 'XL-MER', isActive: true },
  { id: 'sku-xl-htm', productId: KAOS_PRODUCT_ID, code: 'XL-HTM', isActive: true },
]

export interface V27OutletCase {
  name: string
  product: AvailabilityProductLike
  skus: readonly (AvailabilitySkuLike & { code: string })[]
  outletARows: readonly AvailabilityRow[]
  outletBRows: readonly AvailabilityRow[]
  outletCRows: readonly AvailabilityRow[]
  expectedCounts: { A: number; B: number; C: number }
}

/**
 * Canonical verification vectors V-27 (PRD §7.2 / BR-CAT-010/016).
 */
export const V27_AVAILABILITY_VECTORS: readonly V27OutletCase[] = [
  {
    name: 'Step 1: 6 initial SKUs, Outlet B hides 3 Red variants -> A=6, B=3, C=6',
    product: { id: KAOS_PRODUCT_ID, isActive: true },
    skus: KAOS_INITIAL_SKUS,
    outletARows: [{ productId: KAOS_PRODUCT_ID, skuId: null, status: 'AVAILABLE' }],
    outletBRows: [
      { productId: KAOS_PRODUCT_ID, skuId: null, status: 'AVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-s-mer', status: 'UNAVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-m-mer', status: 'UNAVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-l-mer', status: 'UNAVAILABLE' },
    ],
    outletCRows: [{ productId: KAOS_PRODUCT_ID, skuId: null, status: 'AVAILABLE' }],
    expectedCounts: { A: 6, B: 3, C: 6 },
  },
  {
    name: 'Step 2: add XL (2 SKUs with no copied overrides) -> A=8, B=5, C=8',
    product: { id: KAOS_PRODUCT_ID, isActive: true },
    skus: KAOS_WITH_XL_SKUS,
    outletARows: [{ productId: KAOS_PRODUCT_ID, skuId: null, status: 'AVAILABLE' }],
    outletBRows: [
      { productId: KAOS_PRODUCT_ID, skuId: null, status: 'AVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-s-mer', status: 'UNAVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-m-mer', status: 'UNAVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-l-mer', status: 'UNAVAILABLE' },
    ],
    outletCRows: [{ productId: KAOS_PRODUCT_ID, skuId: null, status: 'AVAILABLE' }],
    expectedCounts: { A: 8, B: 5, C: 8 },
  },
  {
    name: 'Step 3: Outlet C product UNAVAILABLE + L-HTM AVAILABLE override -> C=1',
    product: { id: KAOS_PRODUCT_ID, isActive: true },
    skus: KAOS_WITH_XL_SKUS,
    outletARows: [{ productId: KAOS_PRODUCT_ID, skuId: null, status: 'AVAILABLE' }],
    outletBRows: [
      { productId: KAOS_PRODUCT_ID, skuId: null, status: 'AVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-s-mer', status: 'UNAVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-m-mer', status: 'UNAVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-l-mer', status: 'UNAVAILABLE' },
    ],
    outletCRows: [
      { productId: KAOS_PRODUCT_ID, skuId: null, status: 'UNAVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-l-htm', status: 'AVAILABLE' },
    ],
    expectedCounts: { A: 8, B: 5, C: 1 },
  },
  {
    name: 'Step 4: global product.isActive=false overrides all outlet rows -> 0/0/0',
    product: { id: KAOS_PRODUCT_ID, isActive: false },
    skus: KAOS_WITH_XL_SKUS,
    outletARows: [{ productId: KAOS_PRODUCT_ID, skuId: null, status: 'AVAILABLE' }],
    outletBRows: [
      { productId: KAOS_PRODUCT_ID, skuId: null, status: 'AVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-s-mer', status: 'UNAVAILABLE' },
    ],
    outletCRows: [
      { productId: KAOS_PRODUCT_ID, skuId: null, status: 'UNAVAILABLE' },
      { productId: KAOS_PRODUCT_ID, skuId: 'sku-l-htm', status: 'AVAILABLE' },
    ],
    expectedCounts: { A: 0, B: 0, C: 0 },
  },
]

/**
 * BR-CAT-016 five-row precedence truth table.
 */
export const BR_CAT_016_TRUTH_TABLE: ReadonlyArray<{
  label: string
  input: Parameters<typeof import('./availability').effectiveAvailability>[0]
  expected: boolean
}> = [
  {
    label: 'row 1: global inactive product blocks despite AVAILABLE rows',
    input: {
      productActive: false,
      skuActive: true,
      productRow: { productId: 'p1', skuId: null, status: 'AVAILABLE' },
      skuOverride: { productId: 'p1', skuId: 's1', status: 'AVAILABLE' },
    },
    expected: false,
  },
  {
    label: 'row 2: global inactive SKU blocks despite AVAILABLE rows',
    input: {
      productActive: true,
      skuActive: false,
      productRow: { productId: 'p1', skuId: null, status: 'AVAILABLE' },
      skuOverride: { productId: 'p1', skuId: 's1', status: 'AVAILABLE' },
    },
    expected: false,
  },
  {
    label: 'row 3: active SKU override UNAVAILABLE overrides AVAILABLE product row',
    input: {
      productActive: true,
      skuActive: true,
      productRow: { productId: 'p1', skuId: null, status: 'AVAILABLE' },
      skuOverride: { productId: 'p1', skuId: 's1', status: 'UNAVAILABLE' },
    },
    expected: false,
  },
  {
    label: 'row 4: active SKU override AVAILABLE overrides UNAVAILABLE product row',
    input: {
      productActive: true,
      skuActive: true,
      productRow: { productId: 'p1', skuId: null, status: 'UNAVAILABLE' },
      skuOverride: { productId: 'p1', skuId: 's1', status: 'AVAILABLE' },
    },
    expected: true,
  },
  {
    label: 'row 5: deleted SKU override falls back to product row (or true if none)',
    input: {
      productActive: true,
      skuActive: true,
      productRow: { productId: 'p1', skuId: null, status: 'UNAVAILABLE' },
      skuOverride: { productId: 'p1', skuId: 's1', status: 'AVAILABLE', deleted: true },
    },
    expected: false,
  },
]
