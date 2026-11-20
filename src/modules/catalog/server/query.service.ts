import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { visibleSkusForOutlet, type AvailabilityStatus, type ProductType } from '../shared'
import { requireCatalogPermission, type CatalogActor } from './auth'
import {
  listAvailabilityByProductIds,
  type AvailabilityRow,
} from './availability.repo'
import { listCategories, type CategoryRow } from './category.repo'
import { listActivePriceEntriesBySkuIds, type PriceEntryRow } from './price.repo'
import { findProductById, type ProductRow } from './product.repo'
import {
  queryAdminProductList,
  queryAvailabilityProductPage,
  queryPriceMatrixPairs,
  queryScopedOutlets,
  type OutletSummary,
} from './query.repo'
import { listSkuUomsBySkuIds, type SkuUomRow } from './sku-uom.repo'
import {
  listAttributeValuesByAttributes,
  listProductAttributes,
  listSkuAttributeValueLinks,
  listSkusByProduct,
  listSkusByProductIds,
  type AttributeValueRow,
  type ProductAttributeRow,
  type SkuRow,
} from './variant.repo'

export interface AdminProductListItem {
  id: string
  code: string
  name: string
  categoryId: string
  categoryPath: string
  productType: ProductType
  skuCount: number
  priceRange: { min: number; max: number } | null
  availability: { available: number; total: number }
  isActive: boolean
}

export interface AdminProductListResult {
  items: AdminProductListItem[]
  total: number
  page: number
  pageSize: number
}

export interface AdminProductDetail {
  product: ProductRow
  attributes: Array<{ attribute: ProductAttributeRow; values: AttributeValueRow[] }>
  skus: SkuRow[]
  skuAttributeLinks: Array<{ skuId: string; attributeValueId: string }>
  skuUoms: SkuUomRow[]
  prices: PriceEntryRow[]
  availability: AvailabilityRow[]
  outlets: OutletSummary[]
}

export interface PriceMatrixRow {
  productId: string
  productCode: string
  productName: string
  categoryPath: string
  isOpenPrice: boolean
  skuId: string
  skuCode: string
  variantLabel: string | null
  uomId: string
  uomCode: string
  uomName: string
  isBase: boolean
  defaultPrice: number | null
  outletPrices: Record<string, number | null>
}

export interface PriceMatrixResult {
  rows: PriceMatrixRow[]
  outlets: OutletSummary[]
  canEditDefault: boolean
  total: number
  page: number
  pageSize: number
}

export interface AvailabilityMatrixRow {
  productId: string
  productCode: string
  productName: string
  categoryPath: string
  isActive: boolean
  skus: Array<{
    id: string
    skuCode: string
    variantLabel: string | null
    isActive: boolean
  }>
  productStatuses: Record<string, AvailabilityStatus>
  skuOverrides: Record<string, AvailabilityStatus>
  effectiveCounts: Record<string, { available: number; total: number }>
}

export interface AvailabilityMatrixResult {
  rows: AvailabilityMatrixRow[]
  outlets: OutletSummary[]
  scopedOutletIds: string[] | null
  total: number
  page: number
  pageSize: number
}

function buildCategoryPathHelpers(categories: readonly CategoryRow[]) {
  const catById = new Map(categories.map((c) => [c.id, c]))
  const childrenByParent = new Map<string, string[]>()
  for (const c of categories) {
    if (c.parentId) {
      const list = childrenByParent.get(c.parentId) ?? []
      list.push(c.id)
      childrenByParent.set(c.parentId, list)
    }
  }
  const pathOf = (categoryId: string): string => {
    const c = catById.get(categoryId)
    if (!c) return ''
    if (!c.parentId) return c.name
    const parent = catById.get(c.parentId)
    return parent ? `${parent.name} > ${c.name}` : c.name
  }
  const subtreeIds = (categoryId?: string): string[] | null => {
    if (!categoryId) return null
    return [categoryId, ...(childrenByParent.get(categoryId) ?? [])]
  }
  return { pathOf, subtreeIds }
}

function clampPage(rawPage?: number): number {
  return rawPage && Number.isSafeInteger(rawPage) && rawPage >= 1 ? rawPage : 1
}

function clampPageSize(rawSize?: number, fallback = 50): number {
  if (!rawSize || !Number.isSafeInteger(rawSize) || rawSize < 1) return fallback
  return Math.min(100, rawSize)
}

export async function listCatalogOutlets(actor: CatalogActor): Promise<OutletSummary[]> {
  requireCatalogPermission(actor)
  const scopeIds = actor.outletIds === null ? null : (actor.outletIds ?? [])
  return withTenantReadOnly(actor.tenantId, (tx) =>
    queryScopedOutlets(tx, actor.tenantId, scopeIds),
  )
}

export async function listAdminProducts(
  actor: CatalogActor,
  params?: {
    search?: string
    categoryId?: string
    type?: ProductType
    page?: number
    pageSize?: number
  },
): Promise<AdminProductListResult> {
  requireCatalogPermission(actor)
  const page = clampPage(params?.page)
  const pageSize = clampPageSize(params?.pageSize, 50)
  const cleanSearch = params?.search?.trim() || undefined
  const scopeIds = actor.outletIds === null ? null : (actor.outletIds ?? [])

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const [categories, outlets] = await Promise.all([
      listCategories(tx, actor.tenantId),
      queryScopedOutlets(tx, actor.tenantId, scopeIds),
    ])
    const { pathOf, subtreeIds } = buildCategoryPathHelpers(categories)

    const { total, rows } = await queryAdminProductList(tx, {
      tenantId: actor.tenantId,
      search: cleanSearch,
      categoryIds: subtreeIds(params?.categoryId),
      productType: params?.type,
      page,
      pageSize,
      scopedOutletIds: outlets.map((o) => o.id),
    })

    const totalOutlets = outlets.length
    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        categoryId: r.categoryId,
        categoryPath: pathOf(r.categoryId),
        productType: r.productType,
        skuCount: r.skuCount,
        priceRange:
          r.minPrice !== null && r.maxPrice !== null
            ? { min: r.minPrice, max: r.maxPrice }
            : null,
        availability: {
          available: r.isActive ? Math.max(0, totalOutlets - r.unavailableOutlets) : 0,
          total: totalOutlets,
        },
        isActive: r.isActive,
      })),
      total,
      page,
      pageSize,
    }
  })
}

export async function getAdminProductDetail(
  actor: CatalogActor,
  rawProductId: string,
): Promise<AdminProductDetail | null> {
  requireCatalogPermission(actor)
  const idRes = z.string().uuid().safeParse(rawProductId)
  if (!idRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid product id')
  }
  const productId = idRes.data
  const scopeIds = actor.outletIds === null ? null : (actor.outletIds ?? [])

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const prod = await findProductById(tx, actor.tenantId, productId)
    if (!prod) return null

    const [attrs, skus, outlets, rawAvail] = await Promise.all([
      listProductAttributes(tx, actor.tenantId, prod.id),
      listSkusByProduct(tx, actor.tenantId, prod.id),
      queryScopedOutlets(tx, actor.tenantId, scopeIds),
      listAvailabilityByProductIds(tx, actor.tenantId, [prod.id]),
    ])
    const skuIds = skus.map((s) => s.id)
    const [attrValues, links, skuUoms, rawPrices] = await Promise.all([
      listAttributeValuesByAttributes(
        tx,
        actor.tenantId,
        attrs.map((a) => a.id),
      ),
      listSkuAttributeValueLinks(tx, actor.tenantId, skuIds),
      listSkuUomsBySkuIds(tx, actor.tenantId, skuIds),
      listActivePriceEntriesBySkuIds(tx, actor.tenantId, skuIds),
    ])

    const allowedSet = new Set(outlets.map((o) => o.id))
    const availability = rawAvail.filter((a) => allowedSet.has(a.outletId))
    const prices = rawPrices.filter((p) => p.outletId === null || allowedSet.has(p.outletId))

    const valsByAttr = new Map<string, AttributeValueRow[]>()
    for (const v of attrValues) {
      const arr = valsByAttr.get(v.attributeId) ?? []
      arr.push(v)
      valsByAttr.set(v.attributeId, arr)
    }

    return {
      product: prod,
      attributes: attrs.map((attribute) => ({
        attribute,
        values: valsByAttr.get(attribute.id) ?? [],
      })),
      skus,
      skuAttributeLinks: links.map((l) => ({ skuId: l.skuId, attributeValueId: l.attributeValueId })),
      skuUoms,
      prices,
      availability,
      outlets,
    }
  })
}

export async function getPriceMatrix(
  actor: CatalogActor,
  params?: {
    search?: string
    categoryId?: string
    onlyMissing?: boolean
    page?: number
    pageSize?: number
  },
): Promise<PriceMatrixResult> {
  requireCatalogPermission(actor)
  const page = clampPage(params?.page)
  const pageSize = clampPageSize(params?.pageSize, 100)
  const cleanSearch = params?.search?.trim() || undefined
  const scopeIds = actor.outletIds === null ? null : (actor.outletIds ?? [])

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const [categories, outlets] = await Promise.all([
      listCategories(tx, actor.tenantId),
      queryScopedOutlets(tx, actor.tenantId, scopeIds),
    ])
    const { pathOf, subtreeIds } = buildCategoryPathHelpers(categories)

    const { total, rows } = await queryPriceMatrixPairs(tx, {
      tenantId: actor.tenantId,
      search: cleanSearch,
      categoryIds: subtreeIds(params?.categoryId),
      onlyMissing: params?.onlyMissing ?? false,
      page,
      pageSize,
    })

    const skuIds = Array.from(new Set(rows.map((r) => r.skuId)))
    const entries = await listActivePriceEntriesBySkuIds(tx, actor.tenantId, skuIds)

    const defaultMap = new Map<string, number>()
    const outletMap = new Map<string, number>()
    const allowedSet = new Set(outlets.map((o) => o.id))

    for (const e of entries) {
      if (e.outletId === null) {
        defaultMap.set(`${e.skuId}:${e.uomId}`, e.price)
      } else if (allowedSet.has(e.outletId)) {
        outletMap.set(`${e.skuId}:${e.uomId}:${e.outletId}`, e.price)
      }
    }

    return {
      rows: rows.map((r) => {
        const outletPrices: Record<string, number | null> = {}
        for (const o of outlets) {
          outletPrices[o.id] = outletMap.get(`${r.skuId}:${r.uomId}:${o.id}`) ?? null
        }
        return {
          productId: r.productId,
          productCode: r.productCode,
          productName: r.productName,
          categoryPath: pathOf(r.categoryId),
          isOpenPrice: r.isOpenPrice,
          skuId: r.skuId,
          skuCode: r.skuCode,
          variantLabel: r.variantLabel,
          uomId: r.uomId,
          uomCode: r.uomCode,
          uomName: r.uomName,
          isBase: r.isBase,
          defaultPrice: defaultMap.get(`${r.skuId}:${r.uomId}`) ?? null,
          outletPrices,
        }
      }),
      outlets,
      canEditDefault: actor.outletIds === null,
      total,
      page,
      pageSize,
    }
  })
}

export async function getAvailabilityMatrix(
  actor: CatalogActor,
  params?: {
    search?: string
    categoryId?: string
    onlyExceptions?: boolean
    page?: number
    pageSize?: number
  },
): Promise<AvailabilityMatrixResult> {
  requireCatalogPermission(actor)
  const page = clampPage(params?.page)
  const pageSize = clampPageSize(params?.pageSize, 50)
  const cleanSearch = params?.search?.trim() || undefined

  // Load all tenant outlets so matrix columns can display locked outlets for Managers,
  // while `scopedOutletIds` tells UI which columns are editable.
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const [categories, allOutlets] = await Promise.all([
      listCategories(tx, actor.tenantId),
      queryScopedOutlets(tx, actor.tenantId, null),
    ])
    const { pathOf, subtreeIds } = buildCategoryPathHelpers(categories)
    const scopedOutletIds =
      actor.outletIds === null ? null : allOutlets.filter((o) => actor.outletIds?.includes(o.id)).map((o) => o.id)
    const queryScopeOutlets = scopedOutletIds ?? allOutlets.map((o) => o.id)

    const { total, rows: productRows } = await queryAvailabilityProductPage(tx, {
      tenantId: actor.tenantId,
      search: cleanSearch,
      categoryIds: subtreeIds(params?.categoryId),
      onlyExceptions: params?.onlyExceptions ?? false,
      scopedOutletIds: queryScopeOutlets,
      page,
      pageSize,
    })

    const productIds = productRows.map((p) => p.productId)
    const [allSkus, allAvail] = await Promise.all([
      listSkusByProductIds(tx, actor.tenantId, productIds),
      listAvailabilityByProductIds(tx, actor.tenantId, productIds),
    ])

    const skusByProd = new Map<string, SkuRow[]>()
    for (const s of allSkus) {
      const list = skusByProd.get(s.productId) ?? []
      list.push(s)
      skusByProd.set(s.productId, list)
    }

    const availByOutletProd = new Map<string, AvailabilityRow[]>()
    for (const a of allAvail) {
      const key = `${a.outletId}:${a.productId}`
      const list = availByOutletProd.get(key) ?? []
      list.push(a)
      availByOutletProd.set(key, list)
    }

    const matrixRows: AvailabilityMatrixRow[] = productRows.map((p) => {
      const pSkus = skusByProd.get(p.productId) ?? []
      const productStatuses: Record<string, AvailabilityStatus> = {}
      const skuOverrides: Record<string, AvailabilityStatus> = {}
      const effectiveCounts: Record<string, { available: number; total: number }> = {}

      for (const outlet of allOutlets) {
        const outletRows = availByOutletProd.get(`${outlet.id}:${p.productId}`) ?? []
        const prodRow = outletRows.find((r) => r.skuId === null)
        productStatuses[outlet.id] = prodRow?.status ?? 'AVAILABLE'
        for (const r of outletRows) {
          if (r.skuId !== null) {
            skuOverrides[`${outlet.id}:${r.skuId}`] = r.status
          }
        }
        const visible = visibleSkusForOutlet(
          [{ id: p.productId, isActive: p.isActive }],
          pSkus.map((s) => ({ id: s.id, productId: s.productId, isActive: s.isActive })),
          outletRows,
        )
        effectiveCounts[outlet.id] = { available: visible.length, total: pSkus.length }
      }

      return {
        productId: p.productId,
        productCode: p.productCode,
        productName: p.productName,
        categoryPath: pathOf(p.categoryId),
        isActive: p.isActive,
        skus: pSkus.map((s) => ({
          id: s.id,
          skuCode: s.skuCode,
          variantLabel: s.variantLabel,
          isActive: s.isActive,
        })),
        productStatuses,
        skuOverrides,
        effectiveCounts,
      }
    })

    return {
      rows: matrixRows,
      outlets: allOutlets,
      scopedOutletIds,
      total,
      page,
      pageSize,
    }
  })
}
