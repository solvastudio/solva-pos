import '@tanstack/react-start/server-only'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { category, product } from './schema'

export interface CategoryRow {
  id: string
  parentId: string | null
  name: string
  sortOrder: number
  version: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

const categorySelect = {
  id: category.id,
  parentId: category.parentId,
  name: category.name,
  sortOrder: category.sortOrder,
  version: category.version,
  deletedAt: category.deletedAt,
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
}

export async function findCategoryById(
  tx: TenantTx,
  tenantId: string,
  id: string,
): Promise<CategoryRow | null> {
  const rows = await tx
    .select(categorySelect)
    .from(category)
    .where(and(eq(category.tenantId, tenantId), eq(category.id, id), isNull(category.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function listCategories(tx: TenantTx, tenantId: string): Promise<CategoryRow[]> {
  return tx
    .select(categorySelect)
    .from(category)
    .where(and(eq(category.tenantId, tenantId), isNull(category.deletedAt)))
    .orderBy(asc(category.sortOrder), asc(category.name), asc(category.id))
}

export async function hasActiveChildCategories(
  tx: TenantTx,
  tenantId: string,
  categoryId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: category.id })
    .from(category)
    .where(
      and(
        eq(category.tenantId, tenantId),
        eq(category.parentId, categoryId),
        isNull(category.deletedAt),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export async function hasActiveProductsInCategory(
  tx: TenantTx,
  tenantId: string,
  categoryId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: product.id })
    .from(product)
    .where(
      and(
        eq(product.tenantId, tenantId),
        eq(product.categoryId, categoryId),
        isNull(product.deletedAt),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export async function insertCategoryRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    parentId: string | null
    name: string
    sortOrder: number
    nowIso: string
  },
): Promise<CategoryRow> {
  const rows = await tx
    .insert(category)
    .values({
      id: params.id,
      tenantId: w.tenantId,
      version: w.version,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
      deletedAt: null,
      parentId: params.parentId,
      name: params.name,
      sortOrder: params.sortOrder,
    })
    .returning(categorySelect)
  return rows[0]!
}

export async function updateCategoryRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    parentId?: string | null
    name?: string
    sortOrder?: number
    nowIso: string
  },
): Promise<CategoryRow | null> {
  const rows = await tx
    .update(category)
    .set({
      ...(params.parentId !== undefined ? { parentId: params.parentId } : {}),
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.sortOrder !== undefined ? { sortOrder: params.sortOrder } : {}),
      version: w.version,
      updatedAt: params.nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(category.tenantId, w.tenantId), eq(category.id, params.id), isNull(category.deletedAt)))
    .returning(categorySelect)
  return rows[0] ?? null
}

export async function tombstoneCategoryRow(
  tx: TenantTx,
  w: MasterWriter,
  id: string,
  nowIso: string,
): Promise<boolean> {
  const rows = await tx
    .update(category)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(category.tenantId, w.tenantId), eq(category.id, id), isNull(category.deletedAt)))
    .returning({ id: category.id })
  return rows.length > 0
}
