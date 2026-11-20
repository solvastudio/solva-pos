import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import {
  AVAILABILITY_STATUSES,
  visibleSkusForOutlet,
  type AvailabilityStatus,
} from '../shared'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  type CatalogActor,
  type CatalogServiceDeps,
} from './auth'
import {
  findAvailabilityRow,
  listAvailabilityForOutlet,
  tombstoneAvailabilityRow,
  upsertAvailabilityRow,
  type AvailabilityRow,
} from './availability.repo'
import { findProductById, listProducts as listProductRows } from './product.repo'
import { findSkuById, listSkusByProduct, type SkuRow } from './variant.repo'

const MAX_DETAILED_AUDIT_ITEMS = 200

const setProductAvailabilitySchema = z.object({
  outletId: z.string().uuid(),
  productId: z.string().uuid(),
  status: z.enum(AVAILABILITY_STATUSES),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

const setSkuOverrideSchema = z.object({
  outletId: z.string().uuid(),
  productId: z.string().uuid(),
  skuId: z.string().uuid(),
  status: z.enum(AVAILABILITY_STATUSES),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

const clearSkuOverrideSchema = z.object({
  outletId: z.string().uuid(),
  productId: z.string().uuid(),
  skuId: z.string().uuid(),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

const bulkAvailabilityItemSchema = z.object({
  productId: z.string().uuid(),
  skuId: z.string().uuid().nullable().optional(),
  status: z.enum(AVAILABILITY_STATUSES),
})

const bulkSetAvailabilitySchema = z.object({
  outletId: z.string().uuid(),
  items: z.array(bulkAvailabilityItemSchema).min(1).max(2000),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

export type SetProductAvailabilityInput = z.input<typeof setProductAvailabilitySchema>
export type SetSkuOverrideInput = z.input<typeof setSkuOverrideSchema>
export type ClearSkuOverrideInput = z.input<typeof clearSkuOverrideSchema>
export type BulkSetAvailabilityInput = z.input<typeof bulkSetAvailabilitySchema>

function availSnapshot(row: AvailabilityRow | null): Record<string, unknown> | null {
  if (!row || row.deletedAt !== null) return null
  return {
    outletId: row.outletId,
    productId: row.productId,
    skuId: row.skuId,
    status: row.status,
  }
}

export async function listOutletAvailabilityRows(
  actor: CatalogActor,
  rawOutletId: string,
): Promise<AvailabilityRow[]> {
  const outletRes = z.string().uuid().safeParse(rawOutletId)
  if (!outletRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid outlet id')
  }
  const outletId = outletRes.data
  requireCatalogPermission(actor, { outletId })

  return withTenantReadOnly(actor.tenantId, (tx) =>
    listAvailabilityForOutlet(tx, actor.tenantId, outletId),
  )
}

export async function listEffectiveVisibleSkusForOutlet(
  actor: CatalogActor,
  rawOutletId: string,
  rawProductId?: string,
): Promise<SkuRow[]> {
  const outletRes = z.string().uuid().safeParse(rawOutletId)
  if (!outletRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid outlet id')
  }
  const outletId = outletRes.data
  requireCatalogPermission(actor, { outletId })

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const products = rawProductId
      ? (() => findProductById(tx, actor.tenantId, rawProductId).then((p) => (p ? [p] : [])))()
      : listProductRows(tx, actor.tenantId)
    const productList = await products
    const allSkus: SkuRow[] = []
    for (const p of productList) {
      const skus = await listSkusByProduct(tx, actor.tenantId, p.id)
      allSkus.push(...skus)
    }
    const rows = await listAvailabilityForOutlet(
      tx,
      actor.tenantId,
      outletId,
      rawProductId ? [rawProductId] : undefined,
    )
    return visibleSkusForOutlet(productList, allSkus, rows)
  })
}

export async function setProductAvailability(
  actor: CatalogActor,
  rawInput: SetProductAvailabilityInput,
  deps?: CatalogServiceDeps,
): Promise<AvailabilityRow> {
  const parsedRes = setProductAvailabilitySchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid availability input',
    )
  }
  const parsed = parsedRes.data
  requireCatalogPermission(actor, { outletId: parsed.outletId })
  const reasonText = parsed.reasonText?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const prod = await findProductById(tx, actor.tenantId, parsed.productId)
    if (!prod) {
      throw new AppError('VALIDATION_FAILED', 'Product not found')
    }

    const { existing, saved } = await writeMaster(
      tx,
      { actorUserId: actor.appUserId },
      async (w) => {
        const current = await findAvailabilityRow(tx, actor.tenantId, {
          outletId: parsed.outletId,
          productId: parsed.productId,
          skuId: null,
        })
        const row = await upsertAvailabilityRow(tx, w, {
          id: current?.id ?? newIdFrom(deps),
          outletId: parsed.outletId,
          productId: parsed.productId,
          skuId: null,
          status: parsed.status,
          nowIso,
        })
        return { existing: current, saved: row }
      },
    ).then((r) => r.result)

    const beforeData = availSnapshot(existing)

    await appendAudit(
      tx,
      {
        action: 'availability.changed',
        entityType: 'item_outlet_availability',
        entityId: saved.id,
        outletId: parsed.outletId,
        beforeData,
        afterData: availSnapshot(saved),
        reasonText,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => newIdFrom(deps), nowIso: () => nowIso },
    )

    return saved
  })
}

export async function setSkuOverride(
  actor: CatalogActor,
  rawInput: SetSkuOverrideInput,
  deps?: CatalogServiceDeps,
): Promise<AvailabilityRow> {
  const parsedRes = setSkuOverrideSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid SKU override input',
    )
  }
  const parsed = parsedRes.data
  requireCatalogPermission(actor, { outletId: parsed.outletId })
  const reasonText = parsed.reasonText?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const skuRow = await findSkuById(tx, actor.tenantId, parsed.skuId)
    if (!skuRow || skuRow.productId !== parsed.productId) {
      throw new AppError('VALIDATION_FAILED', 'SKU does not belong to product')
    }

    const { existing, saved } = await writeMaster(
      tx,
      { actorUserId: actor.appUserId },
      async (w) => {
        const current = await findAvailabilityRow(tx, actor.tenantId, {
          outletId: parsed.outletId,
          productId: parsed.productId,
          skuId: parsed.skuId,
        })
        const row = await upsertAvailabilityRow(tx, w, {
          id: current?.id ?? newIdFrom(deps),
          outletId: parsed.outletId,
          productId: parsed.productId,
          skuId: parsed.skuId,
          status: parsed.status,
          nowIso,
        })
        return { existing: current, saved: row }
      },
    ).then((r) => r.result)

    const beforeData = availSnapshot(existing)

    await appendAudit(
      tx,
      {
        action: 'availability.changed',
        entityType: 'item_outlet_availability',
        entityId: saved.id,
        outletId: parsed.outletId,
        beforeData,
        afterData: availSnapshot(saved),
        reasonText,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => newIdFrom(deps), nowIso: () => nowIso },
    )

    return saved
  })
}

export async function clearSkuOverride(
  actor: CatalogActor,
  rawInput: ClearSkuOverrideInput,
  deps?: CatalogServiceDeps,
): Promise<{ id: string | null }> {
  const parsedRes = clearSkuOverrideSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid clear override input',
    )
  }
  const parsed = parsedRes.data
  requireCatalogPermission(actor, { outletId: parsed.outletId })
  const reasonText = parsed.reasonText?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findAvailabilityRow(tx, actor.tenantId, {
      outletId: parsed.outletId,
      productId: parsed.productId,
      skuId: parsed.skuId,
    })
    if (!existing || existing.deletedAt !== null) {
      return { id: null }
    }
    const beforeData = availSnapshot(existing)

    await writeMaster(tx, { actorUserId: actor.appUserId }, (w) =>
      tombstoneAvailabilityRow(tx, w, existing.id, nowIso),
    )

    await appendAudit(
      tx,
      {
        action: 'availability.changed',
        entityType: 'item_outlet_availability',
        entityId: existing.id,
        outletId: parsed.outletId,
        beforeData,
        afterData: null,
        reasonText,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => newIdFrom(deps), nowIso: () => nowIso },
    )

    return { id: existing.id }
  })
}

export async function bulkSetAvailability(
  actor: CatalogActor,
  rawInput: BulkSetAvailabilityInput,
  deps?: CatalogServiceDeps,
): Promise<{ rows: AvailabilityRow[]; version: number }> {
  const parsedRes = bulkSetAvailabilitySchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid bulk availability input',
    )
  }
  const parsed = parsedRes.data
  requireCatalogPermission(actor, { outletId: parsed.outletId })
  const reasonText = parsed.reasonText?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const normalizedItems: Array<{
      productId: string
      skuId: string | null
      status: AvailabilityStatus
      existingId: string | null
      beforeData: Record<string, unknown> | null
    }> = []

    for (const item of parsed.items) {
      const skuId = item.skuId ?? null
      const prod = await findProductById(tx, actor.tenantId, item.productId)
      if (!prod) {
        throw new AppError('VALIDATION_FAILED', `Product not found: ${item.productId}`)
      }
      if (skuId !== null) {
        const skuRow = await findSkuById(tx, actor.tenantId, skuId)
        if (!skuRow || skuRow.productId !== item.productId) {
          throw new AppError('VALIDATION_FAILED', `SKU ${skuId} does not belong to product`)
        }
      }
      const existing = await findAvailabilityRow(tx, actor.tenantId, {
        outletId: parsed.outletId,
        productId: item.productId,
        skuId,
      })
      normalizedItems.push({
        productId: item.productId,
        skuId,
        status: item.status,
        existingId: existing?.id ?? null,
        beforeData: availSnapshot(existing),
      })
    }

    const { version, result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      const saved: AvailabilityRow[] = []
      for (const item of normalizedItems) {
        const row = await upsertAvailabilityRow(tx, w, {
          id: item.existingId ?? newIdFrom(deps),
          outletId: parsed.outletId,
          productId: item.productId,
          skuId: item.skuId,
          status: item.status,
          nowIso,
        })
        saved.push(row)
      }
      return saved
    })

    const detailCount = Math.min(result.length, MAX_DETAILED_AUDIT_ITEMS)
    for (let i = 0; i < detailCount; i += 1) {
      const saved = result[i]!
      const orig = normalizedItems[i]!
      await appendAudit(
        tx,
        {
          action: 'availability.changed',
          entityType: 'item_outlet_availability',
          entityId: saved.id,
          outletId: parsed.outletId,
          beforeData: orig.beforeData,
          afterData: availSnapshot(saved),
          reasonText,
          actorUserId: actor.appUserId,
          occurredAt: nowIso,
        },
        { newId: () => newIdFrom(deps), nowIso: () => nowIso },
      )
    }

    if (result.length > MAX_DETAILED_AUDIT_ITEMS) {
      await appendAudit(
        tx,
        {
          action: 'availability.changed',
          entityType: 'item_outlet_availability',
          entityId: parsed.outletId,
          outletId: parsed.outletId,
          beforeData: null,
          afterData: {
            batch: true,
            outletId: parsed.outletId,
            totalCount: result.length,
            auditedDetailCount: detailCount,
          },
          reasonText,
          actorUserId: actor.appUserId,
          occurredAt: nowIso,
        },
        { newId: () => newIdFrom(deps), nowIso: () => nowIso },
      )
    }

    return { rows: result, version }
  })
}
