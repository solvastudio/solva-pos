import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import type { ProductType } from '../shared'
import { chunkArray } from './chunk'
import { product } from './schema'

export interface ProductRow {
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
  version: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

const productSelect = {
  id: product.id,
  categoryId: product.categoryId,
  code: product.code,
  name: product.name,
  productType: product.productType,
  hasVariants: product.hasVariants,
  baseUomId: product.baseUomId,
  trackStock: product.trackStock,
  taxable: product.taxable,
  isActive: product.isActive,
  isOpenPrice: product.isOpenPrice,
  sortOrder: product.sortOrder,
  version: product.version,
  deletedAt: product.deletedAt,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
}

function toProductRow(row: Omit<ProductRow, 'productType'> & { productType: string }): ProductRow {
  return {
    ...row,
    productType: row.productType as ProductType,
  }
}

export async function findProductById(
  tx: TenantTx,
  tenantId: string,
  id: string,
): Promise<ProductRow | null> {
  const rows = await tx
    .select(productSelect)
    .from(product)
    .where(and(eq(product.tenantId, tenantId), eq(product.id, id), isNull(product.deletedAt)))
    .limit(1)
  return rows[0] ? toProductRow(rows[0]) : null
}

export async function listProducts(tx: TenantTx, tenantId: string): Promise<ProductRow[]> {
  const rows = await tx
    .select(productSelect)
    .from(product)
    .where(and(eq(product.tenantId, tenantId), isNull(product.deletedAt)))
    .orderBy(asc(product.sortOrder), asc(product.name), asc(product.id))
  return rows.map(toProductRow)
}

export async function insertProductRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
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
    nowIso: string
  },
): Promise<ProductRow> {
  const rows = await tx
    .insert(product)
    .values({
      id: params.id,
      tenantId: w.tenantId,
      version: w.version,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
      deletedAt: null,
      categoryId: params.categoryId,
      code: params.code,
      name: params.name,
      productType: params.productType,
      hasVariants: params.hasVariants,
      baseUomId: params.baseUomId,
      trackStock: params.trackStock,
      taxable: params.taxable,
      isActive: params.isActive,
      isOpenPrice: params.isOpenPrice,
      sortOrder: params.sortOrder,
    })
    .returning(productSelect)
  return toProductRow(rows[0]!)
}

export async function updateProductRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    categoryId?: string
    code?: string
    name?: string
    hasVariants?: boolean
    baseUomId?: string
    trackStock?: boolean
    taxable?: boolean
    isActive?: boolean
    isOpenPrice?: boolean
    sortOrder?: number
    nowIso: string
  },
): Promise<ProductRow | null> {
  const rows = await tx
    .update(product)
    .set({
      ...(params.categoryId !== undefined ? { categoryId: params.categoryId } : {}),
      ...(params.code !== undefined ? { code: params.code } : {}),
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.hasVariants !== undefined ? { hasVariants: params.hasVariants } : {}),
      ...(params.baseUomId !== undefined ? { baseUomId: params.baseUomId } : {}),
      ...(params.trackStock !== undefined ? { trackStock: params.trackStock } : {}),
      ...(params.taxable !== undefined ? { taxable: params.taxable } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.isOpenPrice !== undefined ? { isOpenPrice: params.isOpenPrice } : {}),
      ...(params.sortOrder !== undefined ? { sortOrder: params.sortOrder } : {}),
      version: w.version,
      updatedAt: params.nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(product.tenantId, w.tenantId), eq(product.id, params.id), isNull(product.deletedAt)))
    .returning(productSelect)
  return rows[0] ? toProductRow(rows[0]) : null
}

export async function tombstoneProductRow(
  tx: TenantTx,
  w: MasterWriter,
  id: string,
  nowIso: string,
): Promise<boolean> {
  const rows = await tx
    .update(product)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(product.tenantId, w.tenantId), eq(product.id, id), isNull(product.deletedAt)))
    .returning({ id: product.id })
  return rows.length > 0
}

export async function listProductsByCodes(
  tx: TenantTx,
  tenantId: string,
  codes: readonly string[],
): Promise<ProductRow[]> {
  if (codes.length === 0) return []
  const out: ProductRow[] = []
  for (const batch of chunkArray(codes)) {
    const rows = await tx
      .select(productSelect)
      .from(product)
      .where(
        and(eq(product.tenantId, tenantId), inArray(product.code, batch), isNull(product.deletedAt)),
      )
    out.push(...rows.map(toProductRow))
  }
  return out
}

export async function listProductsByIds(
  tx: TenantTx,
  tenantId: string,
  ids: readonly string[],
): Promise<ProductRow[]> {
  if (ids.length === 0) return []
  const out: ProductRow[] = []
  for (const batch of chunkArray(ids)) {
    const rows = await tx
      .select(productSelect)
      .from(product)
      .where(and(eq(product.tenantId, tenantId), inArray(product.id, batch), isNull(product.deletedAt)))
    out.push(...rows.map(toProductRow))
  }
  return out
}

export async function upsertProductBatch(
  tx: TenantTx,
  w: MasterWriter,
  items: ReadonlyArray<{
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
    nowIso: string
  }>,
): Promise<void> {
  for (const batch of chunkArray(items)) {
    await tx
      .insert(product)
      .values(
        batch.map((p) => ({
          id: p.id,
          tenantId: w.tenantId,
          version: w.version,
          createdAt: p.nowIso,
          updatedAt: p.nowIso,
          createdBy: w.actorUserId,
          updatedBy: w.actorUserId,
          deletedAt: null,
          categoryId: p.categoryId,
          code: p.code,
          name: p.name,
          productType: p.productType,
          hasVariants: p.hasVariants,
          baseUomId: p.baseUomId,
          trackStock: p.trackStock,
          taxable: p.taxable,
          isActive: p.isActive,
          isOpenPrice: p.isOpenPrice,
          sortOrder: p.sortOrder,
        })),
      )
      .onConflictDoUpdate({
        target: [product.tenantId, product.id],
        set: {
          categoryId: sql`excluded.category_id`,
          code: sql`excluded.code`,
          name: sql`excluded.name`,
          productType: sql`excluded.product_type`,
          hasVariants: sql`excluded.has_variants`,
          baseUomId: sql`excluded.base_uom_id`,
          trackStock: sql`excluded.track_stock`,
          taxable: sql`excluded.taxable`,
          isActive: sql`excluded.is_active`,
          isOpenPrice: sql`excluded.is_open_price`,
          sortOrder: sql`excluded.sort_order`,
          deletedAt: null,
          version: w.version,
          updatedAt: sql`excluded.updated_at`,
          updatedBy: w.actorUserId,
        },
      })
  }
}
