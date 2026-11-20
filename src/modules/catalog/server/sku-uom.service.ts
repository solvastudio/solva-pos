import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { cmpQty, normalizeQty, parseQty, QtyError, type Qty } from '~/lib/kernel'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  type CatalogActor,
  type CatalogServiceDeps,
} from './auth'
import { tombstonePriceEntriesForSkuUom } from './price.repo'
import { findProductById } from './product.repo'
import {
  findActiveSkuUomByBarcode,
  findSkuUomById,
  findSkuUomBySkuAndUom,
  listSkuUomsBySkuIds,
  tombstoneSkuUomRow,
  updateSkuUomRow,
  upsertSkuUomRow,
  type SkuUomRow,
} from './sku-uom.repo'
import { findUomById } from './uom.repo'
import { findSkuById } from './variant.repo'

const uuidSchema = z.string().uuid()

const addSkuUomSchema = z.object({
  skuId: z.string().uuid(),
  uomId: z.string().uuid(),
  conversionFactor: z.string().trim().min(1),
  barcode: z.string().trim().max(64).nullable().optional(),
})

const updateSkuUomSchema = z.object({
  id: z.string().uuid(),
  conversionFactor: z.string().trim().min(1).optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
})

export type AddSkuUomInput = z.input<typeof addSkuUomSchema>
export type UpdateSkuUomInput = z.input<typeof updateSkuUomSchema>

function validatePositiveConversionFactor(rawFactor: string): Qty {
  let qty: Qty
  try {
    qty = parseQty(rawFactor)
  } catch (err) {
    if (err instanceof QtyError) {
      throw new AppError('VALIDATION_FAILED', err.message)
    }
    throw err
  }
  if (cmpQty(qty, '0' as Qty) <= 0) {
    throw new AppError('VALIDATION_FAILED', 'Conversion factor must be greater than zero')
  }
  return normalizeQty(qty)
}

export async function listSkuUoms(actor: CatalogActor, rawSkuId: string): Promise<SkuUomRow[]> {
  requireCatalogPermission(actor)
  const idRes = uuidSchema.safeParse(rawSkuId)
  if (!idRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid SKU id')
  }
  return withTenantReadOnly(actor.tenantId, (tx) => listSkuUomsBySkuIds(tx, actor.tenantId, [idRes.data]))
}

export async function addSkuUom(
  actor: CatalogActor,
  rawInput: AddSkuUomInput,
  deps?: CatalogServiceDeps,
): Promise<SkuUomRow> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const parsedRes = addSkuUomSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid SKU-UOM input',
    )
  }
  const parsed = parsedRes.data
  const normalizedFactor = validatePositiveConversionFactor(parsed.conversionFactor)
  const cleanBarcode = parsed.barcode?.trim() || null
  const nowIso = nowIsoFrom(deps)
  const nextId = newIdFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const skuRow = await findSkuById(tx, actor.tenantId, parsed.skuId)
    if (!skuRow) {
      throw new AppError('VALIDATION_FAILED', 'SKU not found')
    }
    const productRow = await findProductById(tx, actor.tenantId, skuRow.productId)
    if (!productRow) {
      throw new AppError('VALIDATION_FAILED', 'Product not found')
    }
    if (parsed.uomId === productRow.baseUomId) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.baseUomAlreadyAttached')
    }

    const uomRow = await findUomById(tx, actor.tenantId, parsed.uomId)
    if (!uomRow) {
      throw new AppError('VALIDATION_FAILED', 'UOM not found')
    }

    const existing = await findSkuUomBySkuAndUom(tx, actor.tenantId, parsed.skuId, parsed.uomId)
    if (existing) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.uomAlreadyAttached')
    }

    if (cleanBarcode !== null) {
      const dupBarcode = await findActiveSkuUomByBarcode(tx, actor.tenantId, cleanBarcode)
      if (dupBarcode) {
        throw new AppError('VALIDATION_FAILED', 'admin.catalog.barcodeTaken')
      }
    }

    const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, (w) =>
      upsertSkuUomRow(tx, w, {
        id: nextId,
        skuId: parsed.skuId,
        uomId: parsed.uomId,
        conversionFactor: normalizedFactor,
        isBase: false,
        barcode: cleanBarcode,
        nowIso,
      }),
    )
    return result
  })
}

export async function updateSkuUom(
  actor: CatalogActor,
  rawInput: UpdateSkuUomInput,
  deps?: CatalogServiceDeps,
): Promise<SkuUomRow> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const parsedRes = updateSkuUomSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid SKU-UOM input',
    )
  }
  const parsed = parsedRes.data
  const normalizedFactor =
    parsed.conversionFactor !== undefined
      ? validatePositiveConversionFactor(parsed.conversionFactor)
      : undefined
  const cleanBarcode =
    parsed.barcode === undefined ? undefined : parsed.barcode?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findSkuUomById(tx, actor.tenantId, parsed.id)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'SKU-UOM not found')
    }
    if (existing.isBase && normalizedFactor !== undefined && normalizedFactor !== '1') {
      throw new AppError('VALIDATION_FAILED', 'Base UOM conversion factor must remain 1')
    }
    if (cleanBarcode !== undefined && cleanBarcode !== null) {
      const dupBarcode = await findActiveSkuUomByBarcode(
        tx,
        actor.tenantId,
        cleanBarcode,
        existing.id,
      )
      if (dupBarcode) {
        throw new AppError('VALIDATION_FAILED', 'admin.catalog.barcodeTaken')
      }
    }

    const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      const updated = await updateSkuUomRow(tx, w, {
        id: existing.id,
        ...(normalizedFactor !== undefined ? { conversionFactor: normalizedFactor } : {}),
        ...(cleanBarcode !== undefined ? { barcode: cleanBarcode } : {}),
        nowIso,
      })
      if (!updated) {
        throw new AppError('VALIDATION_FAILED', 'SKU-UOM not found')
      }
      return updated
    })
    return result
  })
}

export async function removeSkuUom(
  actor: CatalogActor,
  rawId: string,
  deps?: CatalogServiceDeps,
): Promise<{ id: string }> {
  requireCatalogPermission(actor, { requireTenantWide: true })
  const idRes = uuidSchema.safeParse(rawId)
  if (!idRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid SKU-UOM id')
  }
  const id = idRes.data
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findSkuUomById(tx, actor.tenantId, id)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'SKU-UOM not found')
    }
    if (existing.isBase) {
      throw new AppError('VALIDATION_FAILED', 'admin.catalog.cannotRemoveBaseUom')
    }

    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tombstonePriceEntriesForSkuUom(tx, w, existing.skuId, existing.uomId, nowIso)
      const ok = await tombstoneSkuUomRow(tx, w, existing.id, nowIso)
      if (!ok) {
        throw new AppError('VALIDATION_FAILED', 'SKU-UOM not found')
      }
    })
    return { id }
  })
}
