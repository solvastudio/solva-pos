import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { createUomSchema, updateUomSchema, type CreateUomInput, type UpdateUomInput } from '../shared'
import { newIdFrom, nowIsoFrom, requireCatalogPermission, type CatalogActor, type CatalogServiceDeps } from './auth'
import {
  findUomById,
  insertUomRow,
  isUomReferencedByActiveProductOrSkuUom,
  listUoms as listUomRows,
  tombstoneUomRow,
  updateUomRow,
  type UomRow,
} from './uom.repo'

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

export async function listUoms(actor: CatalogActor): Promise<UomRow[]> {
  requireCatalogPermission(actor)
  return withTenantReadOnly(actor.tenantId, (tx) => listUomRows(tx, actor.tenantId))
}

export async function createUom(
  actor: CatalogActor,
  rawInput: CreateUomInput,
  deps?: CatalogServiceDeps,
): Promise<UomRow> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const parsedRes = createUomSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError('VALIDATION_FAILED', parsedRes.error.issues[0]?.message ?? 'Invalid UOM input')
  }
  const parsed = parsedRes.data
  const id = newIdFrom(deps)
  const nowIso = nowIsoFrom(deps)

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, (w) =>
        insertUomRow(tx, w, {
          id,
          code: parsed.code,
          name: parsed.name,
          allowFraction: parsed.allowFraction,
          nowIso,
        }),
      )
      return result
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.uomCodeTaken')
    }
    throw err
  }
}

export async function updateUom(
  actor: CatalogActor,
  rawInput: UpdateUomInput,
  deps?: CatalogServiceDeps,
): Promise<UomRow> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const parsedRes = updateUomSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError('VALIDATION_FAILED', parsedRes.error.issues[0]?.message ?? 'Invalid UOM input')
  }
  const parsed = parsedRes.data
  const nowIso = nowIsoFrom(deps)

  try {
    return await withTenant(actor.tenantId, async (tx) => {
      const existing = await findUomById(tx, actor.tenantId, parsed.id)
      if (!existing) {
        throw new AppError('VALIDATION_FAILED', 'UOM not found')
      }

      const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
        const updated = await updateUomRow(tx, w, {
          id: parsed.id,
          ...(parsed.code !== undefined ? { code: parsed.code } : {}),
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.allowFraction !== undefined ? { allowFraction: parsed.allowFraction } : {}),
          nowIso,
        })
        if (!updated) {
          throw new AppError('VALIDATION_FAILED', 'UOM not found')
        }
        return updated
      })
      return result
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.uomCodeTaken')
    }
    throw err
  }
}

export async function deleteUom(
  actor: CatalogActor,
  rawId: string,
  deps?: CatalogServiceDeps,
): Promise<{ id: string }> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const idRes = uuidSchema.safeParse(rawId)
  if (!idRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid UOM id')
  }
  const id = idRes.data
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findUomById(tx, actor.tenantId, id)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'UOM not found')
    }
    if (await isUomReferencedByActiveProductOrSkuUom(tx, actor.tenantId, id)) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.uomInUse')
    }

    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      const ok = await tombstoneUomRow(tx, w, id, nowIso)
      if (!ok) {
        throw new AppError('VALIDATION_FAILED', 'UOM not found')
      }
    })
    return { id }
  })
}
