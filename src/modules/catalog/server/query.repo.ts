import '@tanstack/react-start/server-only'
import { sql, type SQL } from 'drizzle-orm'
import { parseSafeBigint, type TenantTx } from '~/server/db'
import type { ProductType } from '../shared'

export interface OutletSummary {
  id: string
  code: string
  name: string
}

export interface RawProductSummaryRow {
  total: number
  id: string
  code: string
  name: string
  categoryId: string
  productType: ProductType
  isActive: boolean
  skuCount: number
  minPrice: number | null
  maxPrice: number | null
  unavailableOutlets: number
}

export interface RawPriceMatrixPair {
  total: number
  productId: string
  productCode: string
  productName: string
  categoryId: string
  isOpenPrice: boolean
  skuId: string
  skuCode: string
  variantLabel: string | null
  uomId: string
  uomCode: string
  uomName: string
  isBase: boolean
}

export interface RawAvailabilityProductPage {
  total: number
  productId: string
  productCode: string
  productName: string
  categoryId: string
  isActive: boolean
}

export async function queryScopedOutlets(
  tx: TenantTx,
  tenantId: string,
  allowedOutletIds: readonly string[] | null,
): Promise<OutletSummary[]> {
  if (allowedOutletIds !== null && allowedOutletIds.length === 0) {
    return []
  }
  const scopeFilter =
    allowedOutletIds === null
      ? sql`TRUE`
      : sql`id = ANY(ARRAY[${sql.join(
          allowedOutletIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}])`
  const res = await tx.execute(sql`
    SELECT id, code, name
    FROM outlet
    WHERE tenant_id = ${tenantId}::uuid
      AND deleted_at IS NULL
      AND ${scopeFilter}
    ORDER BY code ASC, name ASC, id ASC
  `)
  return res.rows.map((r) => {
    const row = r as { id: string; code: string; name: string }
    return { id: String(row.id), code: String(row.code), name: String(row.name) }
  })
}

function buildCategoryFilterSql(col: SQL, categoryIds?: readonly string[] | null): SQL {
  if (!categoryIds || categoryIds.length === 0) {
    return sql`TRUE`
  }
  return sql`${col} = ANY(ARRAY[${sql.join(
    categoryIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}])`
}

function buildOutletScopeSql(col: SQL, outletIds: readonly string[]): SQL {
  if (outletIds.length === 0) {
    return sql`FALSE`
  }
  return sql`${col} = ANY(ARRAY[${sql.join(
    outletIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}])`
}

export async function queryAdminProductList(
  tx: TenantTx,
  params: {
    tenantId: string
    search?: string
    categoryIds?: readonly string[] | null
    productType?: ProductType
    page: number
    pageSize: number
    scopedOutletIds: readonly string[]
  },
): Promise<{ total: number; rows: RawProductSummaryRow[] }> {
  const offset = (params.page - 1) * params.pageSize
  const like = params.search ? `%${params.search}%` : null
  const searchCond = like
    ? sql`(p.name ILIKE ${like} OR p.code ILIKE ${like})`
    : sql`TRUE`
  const catCond = buildCategoryFilterSql(sql`p.category_id`, params.categoryIds)
  const typeCond = params.productType ? sql`p.product_type = ${params.productType}` : sql`TRUE`
  const availOutletCond = buildOutletScopeSql(sql`a.outlet_id`, params.scopedOutletIds)
  const priceOutletCond =
    params.scopedOutletIds.length === 0
      ? sql`pe.outlet_id IS NULL`
      : sql`(pe.outlet_id IS NULL OR ${buildOutletScopeSql(sql`pe.outlet_id`, params.scopedOutletIds)})`

  const res = await tx.execute(sql`
    WITH filtered AS (
      SELECT p.id, p.code, p.name, p.category_id, p.product_type, p.is_active, p.sort_order
      FROM product p
      WHERE p.tenant_id = ${params.tenantId}::uuid
        AND p.deleted_at IS NULL
        AND ${searchCond}
        AND ${catCond}
        AND ${typeCond}
    ),
    counted AS (
      SELECT count(*)::int AS total FROM filtered
    ),
    paged AS (
      SELECT id, code, name, category_id, product_type, is_active, sort_order
      FROM filtered
      ORDER BY sort_order ASC, name ASC, id ASC
      LIMIT ${params.pageSize}
      OFFSET ${offset}
    ),
    sku_agg AS (
      SELECT s.product_id, count(*)::int AS sku_count
      FROM sku s
      WHERE s.tenant_id = ${params.tenantId}::uuid
        AND s.deleted_at IS NULL
        AND s.product_id IN (SELECT id FROM paged)
      GROUP BY s.product_id
    ),
    price_agg AS (
      SELECT
        s.product_id,
        min(pe.price) AS min_price,
        max(pe.price) AS max_price
      FROM sku s
      JOIN price_entry pe
        ON pe.tenant_id = s.tenant_id
       AND pe.sku_id = s.id
       AND pe.deleted_at IS NULL
      WHERE s.tenant_id = ${params.tenantId}::uuid
        AND s.deleted_at IS NULL
        AND s.product_id IN (SELECT id FROM paged)
        AND ${priceOutletCond}
      GROUP BY s.product_id
    ),
    avail_agg AS (
      SELECT
        a.product_id,
        count(*) FILTER (WHERE a.status = 'UNAVAILABLE')::int AS unavailable_outlets
      FROM item_outlet_availability a
      WHERE a.tenant_id = ${params.tenantId}::uuid
        AND a.deleted_at IS NULL
        AND a.sku_id IS NULL
        AND a.product_id IN (SELECT id FROM paged)
        AND ${availOutletCond}
      GROUP BY a.product_id
    )
    SELECT
      (SELECT total FROM counted) AS total,
      pg.id,
      pg.code,
      pg.name,
      pg.category_id,
      pg.product_type,
      pg.is_active,
      COALESCE(sa.sku_count, 0)::int AS sku_count,
      pa.min_price,
      pa.max_price,
      COALESCE(aa.unavailable_outlets, 0)::int AS unavailable_outlets
    FROM paged pg
    LEFT JOIN sku_agg sa ON sa.product_id = pg.id
    LEFT JOIN price_agg pa ON pa.product_id = pg.id
    LEFT JOIN avail_agg aa ON aa.product_id = pg.id
    ORDER BY pg.sort_order ASC, pg.name ASC, pg.id ASC
  `)

  if (res.rows.length === 0) {
    // When page is empty but filtered rows might exist (e.g. page > totalPages), read exact total
    const cntRes = await tx.execute(sql`
      SELECT count(*)::int AS total
      FROM product p
      WHERE p.tenant_id = ${params.tenantId}::uuid
        AND p.deleted_at IS NULL
        AND ${searchCond}
        AND ${catCond}
        AND ${typeCond}
    `)
    return {
      total: Number((cntRes.rows[0] as { total?: number } | undefined)?.total ?? 0),
      rows: [],
    }
  }

  const total = Number((res.rows[0] as { total: number }).total)
  const rows: RawProductSummaryRow[] = res.rows.map((r) => {
    const row = r as {
      id: string
      code: string
      name: string
      category_id: string
      product_type: string
      is_active: boolean
      sku_count: number
      min_price: number | string | null
      max_price: number | string | null
      unavailable_outlets: number
    }
    return {
      total,
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      categoryId: String(row.category_id),
      productType: row.product_type as ProductType,
      isActive: Boolean(row.is_active),
      skuCount: Number(row.sku_count),
      minPrice: row.min_price === null ? null : parseSafeBigint(row.min_price),
      maxPrice: row.max_price === null ? null : parseSafeBigint(row.max_price),
      unavailableOutlets: Number(row.unavailable_outlets),
    }
  })

  return { total, rows }
}

export async function queryPriceMatrixPairs(
  tx: TenantTx,
  params: {
    tenantId: string
    search?: string
    categoryIds?: readonly string[] | null
    onlyMissing: boolean
    page: number
    pageSize: number
  },
): Promise<{ total: number; rows: RawPriceMatrixPair[] }> {
  const offset = (params.page - 1) * params.pageSize
  const like = params.search ? `%${params.search}%` : null
  const searchCond = like
    ? sql`(p.name ILIKE ${like} OR p.code ILIKE ${like} OR s.sku_code ILIKE ${like} OR COALESCE(su.barcode, '') ILIKE ${like})`
    : sql`TRUE`
  const catCond = buildCategoryFilterSql(sql`p.category_id`, params.categoryIds)
  const missingCond = params.onlyMissing
    ? sql`NOT p.is_open_price AND NOT EXISTS (
        SELECT 1 FROM price_entry pe
        WHERE pe.tenant_id = ${params.tenantId}::uuid
          AND pe.sku_id = s.id
          AND pe.uom_id = su.uom_id
          AND pe.outlet_id IS NULL
          AND pe.deleted_at IS NULL
      )`
    : sql`TRUE`

  const res = await tx.execute(sql`
    WITH filtered AS (
      SELECT
        p.id AS product_id,
        p.code AS product_code,
        p.name AS product_name,
        p.category_id,
        p.is_open_price,
        p.sort_order AS prod_sort,
        s.id AS sku_id,
        s.sku_code,
        s.variant_label,
        s.sort_order AS sku_sort,
        u.id AS uom_id,
        u.code AS uom_code,
        u.name AS uom_name,
        su.is_base
      FROM sku s
      JOIN product p
        ON p.tenant_id = s.tenant_id
       AND p.id = s.product_id
       AND p.deleted_at IS NULL
      JOIN sku_uom su
        ON su.tenant_id = s.tenant_id
       AND su.sku_id = s.id
       AND su.deleted_at IS NULL
      JOIN uom u
        ON u.tenant_id = su.tenant_id
       AND u.id = su.uom_id
       AND u.deleted_at IS NULL
      WHERE s.tenant_id = ${params.tenantId}::uuid
        AND s.deleted_at IS NULL
        AND ${searchCond}
        AND ${catCond}
        AND ${missingCond}
    ),
    counted AS (
      SELECT count(*)::int AS total FROM filtered
    )
    SELECT
      (SELECT total FROM counted) AS total,
      product_id,
      product_code,
      product_name,
      category_id,
      is_open_price,
      sku_id,
      sku_code,
      variant_label,
      uom_id,
      uom_code,
      uom_name,
      is_base
    FROM filtered
    ORDER BY prod_sort ASC, product_name ASC, sku_sort ASC, sku_code ASC, is_base DESC, uom_code ASC
    LIMIT ${params.pageSize}
    OFFSET ${offset}
  `)

  if (res.rows.length === 0) {
    return { total: 0, rows: [] }
  }

  const total = Number((res.rows[0] as { total: number }).total)
  const rows: RawPriceMatrixPair[] = res.rows.map((r) => {
    const row = r as {
      product_id: string
      product_code: string
      product_name: string
      category_id: string
      is_open_price: boolean
      sku_id: string
      sku_code: string
      variant_label: string | null
      uom_id: string
      uom_code: string
      uom_name: string
      is_base: boolean
    }
    return {
      total,
      productId: String(row.product_id),
      productCode: String(row.product_code),
      productName: String(row.product_name),
      categoryId: String(row.category_id),
      isOpenPrice: Boolean(row.is_open_price),
      skuId: String(row.sku_id),
      skuCode: String(row.sku_code),
      variantLabel: row.variant_label === null ? null : String(row.variant_label),
      uomId: String(row.uom_id),
      uomCode: String(row.uom_code),
      uomName: String(row.uom_name),
      isBase: Boolean(row.is_base),
    }
  })

  return { total, rows }
}

export async function queryAvailabilityProductPage(
  tx: TenantTx,
  params: {
    tenantId: string
    search?: string
    categoryIds?: readonly string[] | null
    onlyExceptions: boolean
    scopedOutletIds: readonly string[]
    page: number
    pageSize: number
  },
): Promise<{ total: number; rows: RawAvailabilityProductPage[] }> {
  const offset = (params.page - 1) * params.pageSize
  const like = params.search ? `%${params.search}%` : null
  const searchCond = like ? sql`(p.name ILIKE ${like} OR p.code ILIKE ${like})` : sql`TRUE`
  const catCond = buildCategoryFilterSql(sql`p.category_id`, params.categoryIds)
  const availOutletCond = buildOutletScopeSql(sql`a.outlet_id`, params.scopedOutletIds)
  const exceptionCond = params.onlyExceptions
    ? sql`(
        NOT p.is_active
        OR EXISTS (
          SELECT 1 FROM sku s
          WHERE s.tenant_id = p.tenant_id
            AND s.product_id = p.id
            AND s.deleted_at IS NULL
            AND NOT s.is_active
        )
        OR EXISTS (
          SELECT 1 FROM item_outlet_availability a
          WHERE a.tenant_id = p.tenant_id
            AND a.product_id = p.id
            AND a.deleted_at IS NULL
            AND ${availOutletCond}
            AND (a.status = 'UNAVAILABLE' OR a.sku_id IS NOT NULL)
        )
      )`
    : sql`TRUE`

  const res = await tx.execute(sql`
    WITH filtered AS (
      SELECT p.id, p.code, p.name, p.category_id, p.is_active, p.sort_order
      FROM product p
      WHERE p.tenant_id = ${params.tenantId}::uuid
        AND p.deleted_at IS NULL
        AND ${searchCond}
        AND ${catCond}
        AND ${exceptionCond}
    ),
    counted AS (
      SELECT count(*)::int AS total FROM filtered
    )
    SELECT
      (SELECT total FROM counted) AS total,
      id AS product_id,
      code AS product_code,
      name AS product_name,
      category_id,
      is_active
    FROM filtered
    ORDER BY sort_order ASC, name ASC, id ASC
    LIMIT ${params.pageSize}
    OFFSET ${offset}
  `)

  if (res.rows.length === 0) {
    return { total: 0, rows: [] }
  }

  const total = Number((res.rows[0] as { total: number }).total)
  const rows: RawAvailabilityProductPage[] = res.rows.map((r) => {
    const row = r as {
      product_id: string
      product_code: string
      product_name: string
      category_id: string
      is_active: boolean
    }
    return {
      total,
      productId: String(row.product_id),
      productCode: String(row.product_code),
      productName: String(row.product_name),
      categoryId: String(row.category_id),
      isActive: Boolean(row.is_active),
    }
  })

  return { total, rows }
}
