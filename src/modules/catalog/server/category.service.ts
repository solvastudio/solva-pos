import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { parseOrThrow } from '~/server/parse-or-throw'
import {
  createCategorySchema,
  updateCategorySchema,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '../shared'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  requireCatalogView,
  type CatalogActor,
  type CatalogServiceDeps,
} from './auth'
import {
  findCategoryById,
  hasActiveChildCategories,
  hasActiveProductsInCategory,
  insertCategoryRow,
  listCategories as listCategoryRows,
  tombstoneCategoryRow,
  updateCategoryRow,
  type CategoryRow,
} from './category.repo'

const uuidSchema = z.string().uuid()

function isPgUniqueViolation(err: unknown): boolean {
  let cur: unknown = err
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i += 1) {
    if ('code' in cur && (cur as { code?: unknown }).code === '23505') {
      return true
    }
    cur = 'cause' in cur ? (cur as { cause?: unknown }).cause : null
  }
  return false
}

export async function listCategories(actor: CatalogActor): Promise<CategoryRow[]> {
  requireCatalogView(actor)
  return withTenantReadOnly(actor.tenantId, (tx) => listCategoryRows(tx, actor.tenantId))
}

export async function createCategory(
  actor: CatalogActor,
  rawInput: CreateCategoryInput,
  deps?: CatalogServiceDeps,
): Promise<CategoryRow> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(createCategorySchema, rawInput, 'Invalid category input')
  const parentId = parsed.parentId ?? null
  const id = newIdFrom(deps)
  const nowIso = nowIsoFrom(deps)

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      if (parentId !== null) {
        const parent = await findCategoryById(tx, actor.tenantId, parentId)
        if (!parent) {
          throw new AppError('VALIDATION_FAILED', 'Parent category not found')
        }
        if (parent.parentId !== null) {
          throw new AppError('VALIDATION_FAILED', 'admin.catalog.categoryMaxDepth')
        }
      }

      const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, (w) =>
        insertCategoryRow(tx, w, {
          id,
          parentId,
          name: parsed.name,
          sortOrder: parsed.sortOrder,
          nowIso,
        }),
      )
      return result
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.categoryNameTaken')
    }
    throw err
  }
}

export async function updateCategory(
  actor: CatalogActor,
  rawInput: UpdateCategoryInput,
  deps?: CatalogServiceDeps,
): Promise<CategoryRow> {
  requireCatalogPermission(actor)
  const parsed = parseOrThrow(updateCategorySchema, rawInput, 'Invalid category input')
  const nowIso = nowIsoFrom(deps)

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const existing = await findCategoryById(tx, actor.tenantId, parsed.id)
      if (!existing) {
        throw new AppError('VALIDATION_FAILED', 'Category not found')
      }

      if (parsed.parentId !== undefined && parsed.parentId !== null) {
        if (parsed.parentId === parsed.id) {
          throw new AppError('VALIDATION_FAILED', 'Category cannot be its own parent')
        }
        const parent = await findCategoryById(tx, actor.tenantId, parsed.parentId)
        if (!parent) {
          throw new AppError('VALIDATION_FAILED', 'Parent category not found')
        }
        if (parent.parentId !== null) {
          throw new AppError('VALIDATION_FAILED', 'admin.catalog.categoryMaxDepth')
        }
        const hasChildren = await hasActiveChildCategories(tx, actor.tenantId, parsed.id)
        if (hasChildren) {
          throw new AppError('VALIDATION_FAILED', 'admin.catalog.categoryMaxDepth')
        }
      }

      const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        const updated = await updateCategoryRow(tx, w, {
          id: parsed.id,
          ...(parsed.parentId !== undefined ? { parentId: parsed.parentId } : {}),
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
          nowIso,
        })
        if (!updated) {
          throw new AppError('VALIDATION_FAILED', 'Category not found')
        }
        return updated
      })
      return result
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.categoryNameTaken')
    }
    throw err
  }
}

export async function deleteCategory(
  actor: CatalogActor,
  rawId: string,
  deps?: CatalogServiceDeps,
): Promise<{ id: string }> {
  requireCatalogPermission(actor)
  const idRes = uuidSchema.safeParse(rawId)
  if (!idRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid category id')
  }
  const id = idRes.data
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findCategoryById(tx, actor.tenantId, id)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Category not found')
    }
    if (await hasActiveChildCategories(tx, actor.tenantId, id)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.categoryHasChildren')
    }
    if (await hasActiveProductsInCategory(tx, actor.tenantId, id)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.categoryHasProducts')
    }

    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      const ok = await tombstoneCategoryRow(tx, w, id, nowIso)
      if (!ok) {
        throw new AppError('VALIDATION_FAILED', 'Category not found')
      }
    })
    await appendAudit(
      tx,
      {
        action: 'catalog.changed',
        entityType: 'category',
        entityId: id,
        beforeData: { name: existing.name },
        afterData: { deleted: true },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => newIdFrom(deps), nowIso: () => nowIso },
    )
    return { id }
  })
}
