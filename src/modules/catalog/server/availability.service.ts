import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { parseOrThrow } from '~/server/parse-or-throw'
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
  upsertAvailabilityBatch,
  upsertAvailabilityRow,
  type AvailabilityRow,
} from './availability.repo'
import {
  findProductById,
  listProducts as listProductRows,
  listProductsByIds,
} from './product.repo'
import { findSkuById, listSkusByProductIds, type SkuRow } from './variant.repo'

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
    const skusByProduct = new Map<string, SkuRow[]>()
    for (const row of await listSkusByProductIds(
      tx,
      actor.tenantId,
      productList.map((p) => p.id),
    )) {
      const list = skusByProduct.get(row.productId) ?? []
      list.push(row)
      skusByProduct.set(row.productId, list)
    }
    const allSkus: SkuRow[] = []
    for (const p of productList) {
      const skus = skusByProduct.get(p.id) ?? []
      // Same order as `listSkusByProduct`: sort_order, sku_code, id.
      skus.sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          (a.skuCode < b.skuCode ? -1 : a.skuCode > b.skuCode ? 1 : 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
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
  const parsed = parseOrThrow(setProductAvailabilitySchema, rawInput, 'Invalid availability input')
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
  const parsed = parseOrThrow(setSkuOverrideSchema, rawInput, 'Invalid SKU override input')
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
  const parsed = parseOrThrow(clearSkuOverrideSchema, rawInput, 'Invalid clear override input')
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

interface AvailabilityPlanItem {
  productId: string
  skuId: string | null
  status: AvailabilityStatus
}

function availabilityKey(productId: string, skuId: string | null): string {
  return `${productId}:${skuId ?? 'PRODUCT'}`
}

/** Throws unless every product exists and every SKU belongs to its product. */
async function assertAvailabilityTargets(
  tx: TenantTx,
  tenantId: string,
  items: ReadonlyArray<{ productId: string; skuId: string | null }>,
): Promise<void> {
  const products = await listProductsByIds(tx, tenantId, [...new Set(items.map((i) => i.productId))])
  const productIds = new Set(products.map((p) => p.id))
  const skus = await listSkusByProductIds(tx, tenantId, [...productIds])
  const skuById = new Map(skus.map((s) => [s.id, s] as const))
  for (const item of items) {
    if (!productIds.has(item.productId)) {
      throw new AppError('VALIDATION_FAILED', `Product not found: ${item.productId}`)
    }
    if (item.skuId !== null) {
      const skuRow = skuById.get(item.skuId)
      if (!skuRow || skuRow.productId !== item.productId) {
        throw new AppError('VALIDATION_FAILED', `SKU ${item.skuId} does not belong to product`)
      }
    }
  }
}

/** Active availability rows of one outlet for the given products, keyed by product and SKU. */
async function loadActiveAvailabilityByKey(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
  productIds: readonly string[],
): Promise<Map<string, AvailabilityRow>> {
  const rows = await listAvailabilityForOutlet(tx, tenantId, outletId, [...new Set(productIds)])
  return new Map(rows.map((r) => [availabilityKey(r.productId, r.skuId), r] as const))
}

/** Last occurrence wins, matching the former one-by-one upsert loop. */
function dedupeAvailabilityItems(items: readonly AvailabilityPlanItem[]): AvailabilityPlanItem[] {
  const unique = new Map<string, AvailabilityPlanItem>()
  for (const item of items) unique.set(availabilityKey(item.productId, item.skuId), item)
  return [...unique.values()]
}

async function appendAvailabilityBulkAudit(
  tx: TenantTx,
  actor: CatalogActor,
  deps: CatalogServiceDeps | undefined,
  params: {
    outletId: string
    reasonText: string | null
    nowIso: string
    saved: readonly AvailabilityRow[]
    beforeData: ReadonlyArray<Record<string, unknown> | null>
  },
): Promise<void> {
  const { outletId, reasonText, nowIso, saved, beforeData } = params
  const detailCount = Math.min(saved.length, MAX_DETAILED_AUDIT_ITEMS)
  for (let i = 0; i < detailCount; i += 1) {
    const row = saved[i]!
    await appendAudit(
      tx,
      {
        action: 'availability.changed',
        entityType: 'item_outlet_availability',
        entityId: row.id,
        outletId,
        beforeData: beforeData[i] ?? null,
        afterData: availSnapshot(row),
        reasonText,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => newIdFrom(deps), nowIso: () => nowIso },
    )
  }

  if (saved.length > MAX_DETAILED_AUDIT_ITEMS) {
    await appendAudit(
      tx,
      {
        action: 'availability.changed',
        entityType: 'item_outlet_availability',
        entityId: outletId,
        outletId,
        beforeData: null,
        afterData: {
          batch: true,
          outletId,
          totalCount: saved.length,
          auditedDetailCount: detailCount,
        },
        reasonText,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => newIdFrom(deps), nowIso: () => nowIso },
    )
  }
}

export async function bulkSetAvailability(
  actor: CatalogActor,
  rawInput: BulkSetAvailabilityInput,
  deps?: CatalogServiceDeps,
): Promise<{ rows: AvailabilityRow[]; version: number }> {
  const parsed = parseOrThrow(bulkSetAvailabilitySchema, rawInput, 'Invalid bulk availability input')
  requireCatalogPermission(actor, { outletId: parsed.outletId })
  const reasonText = parsed.reasonText?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const requested: AvailabilityPlanItem[] = parsed.items.map((item) => ({
      productId: item.productId,
      skuId: item.skuId ?? null,
      status: item.status,
    }))
    await assertAvailabilityTargets(tx, actor.tenantId, requested)
    const plan = dedupeAvailabilityItems(requested)
    const productIds = plan.map((i) => i.productId)
    const before = await loadActiveAvailabilityByKey(tx, actor.tenantId, parsed.outletId, productIds)

    const { version, result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await upsertAvailabilityBatch(
        tx,
        w,
        plan.map((item) => ({
          id: newIdFrom(deps),
          outletId: parsed.outletId,
          productId: item.productId,
          skuId: item.skuId,
          status: item.status,
          nowIso,
        })),
      )
      const saved = await loadActiveAvailabilityByKey(tx, actor.tenantId, parsed.outletId, productIds)
      return plan.map((item) => saved.get(availabilityKey(item.productId, item.skuId))!)
    })

    await appendAvailabilityBulkAudit(tx, actor, deps, {
      outletId: parsed.outletId,
      reasonText,
      nowIso,
      saved: result,
      beforeData: plan.map((item) =>
        availSnapshot(before.get(availabilityKey(item.productId, item.skuId)) ?? null),
      ),
    })

    return { rows: result, version }
  })
}

const saveAvailabilityAcrossOutletsSchema = z.object({
  updates: z
    .array(
      z.object({
        outletId: z.string().uuid(),
        productId: z.string().uuid(),
        skuId: z.string().uuid().nullable().optional(),
        status: z.enum(AVAILABILITY_STATUSES),
      }),
    )
    .max(2000)
    .default([]),
  clears: z
    .array(
      z.object({
        outletId: z.string().uuid(),
        productId: z.string().uuid(),
        skuId: z.string().uuid(),
      }),
    )
    .max(2000)
    .default([]),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

export type SaveAvailabilityAcrossOutletsInput = z.input<typeof saveAvailabilityAcrossOutletsSchema>

/**
 * All-or-nothing availability save for several outlets: updates and override clears in one
 * transaction and one master version (`writeMaster` may run only once per transaction).
 */
export async function saveAvailabilityAcrossOutlets(
  actor: CatalogActor,
  rawInput: SaveAvailabilityAcrossOutletsInput,
  deps?: CatalogServiceDeps,
): Promise<{ savedCount: number; version: number | null }> {
  const parsed = parseOrThrow(saveAvailabilityAcrossOutletsSchema, rawInput, 'Invalid availability save input')

  const outletIds = new Set<string>([
    ...parsed.updates.map((u) => u.outletId),
    ...parsed.clears.map((c) => c.outletId),
  ])
  for (const outletId of outletIds) {
    requireCatalogPermission(actor, { outletId })
  }
  if (outletIds.size === 0) {
    return { savedCount: 0, version: null }
  }
  const reasonText = parsed.reasonText?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const requested = parsed.updates.map((u) => ({
      outletId: u.outletId,
      productId: u.productId,
      skuId: u.skuId ?? null,
      status: u.status,
    }))
    await assertAvailabilityTargets(tx, actor.tenantId, requested)

    const updatesByOutlet = new Map<string, AvailabilityPlanItem[]>()
    for (const item of requested) {
      const list = updatesByOutlet.get(item.outletId) ?? []
      list.push({ productId: item.productId, skuId: item.skuId, status: item.status })
      updatesByOutlet.set(item.outletId, list)
    }
    for (const [outletId, list] of updatesByOutlet) {
      updatesByOutlet.set(outletId, dedupeAvailabilityItems(list))
    }

    const productIdsByOutlet = new Map<string, string[]>()
    for (const outletId of outletIds) {
      productIdsByOutlet.set(outletId, [
        ...(updatesByOutlet.get(outletId) ?? []).map((i) => i.productId),
        ...parsed.clears.filter((c) => c.outletId === outletId).map((c) => c.productId),
      ])
    }
    const beforeByOutlet = new Map<string, Map<string, AvailabilityRow>>()
    for (const outletId of outletIds) {
      const productIds = productIdsByOutlet.get(outletId)!
      if (productIds.length > 0) {
        beforeByOutlet.set(
          outletId,
          await loadActiveAvailabilityByKey(tx, actor.tenantId, outletId, productIds),
        )
      }
    }

    const { version, result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await upsertAvailabilityBatch(
        tx,
        w,
        [...updatesByOutlet].flatMap(([outletId, list]) =>
          list.map((item) => ({
            id: newIdFrom(deps),
            outletId,
            productId: item.productId,
            skuId: item.skuId,
            status: item.status,
            nowIso,
          })),
        ),
      )

      const savedByOutlet = new Map<string, AvailabilityRow[]>()
      const clearedRows: AvailabilityRow[] = []
      for (const outletId of outletIds) {
        const productIds = productIdsByOutlet.get(outletId)!
        if (productIds.length === 0) continue
        const afterUpsert = await loadActiveAvailabilityByKey(tx, actor.tenantId, outletId, productIds)
        savedByOutlet.set(
          outletId,
          (updatesByOutlet.get(outletId) ?? []).map(
            (item) => afterUpsert.get(availabilityKey(item.productId, item.skuId))!,
          ),
        )
        for (const clr of parsed.clears.filter((c) => c.outletId === outletId)) {
          const existing = afterUpsert.get(availabilityKey(clr.productId, clr.skuId))
          if (existing) {
            await tombstoneAvailabilityRow(tx, w, existing.id, nowIso)
            clearedRows.push(existing)
          }
        }
      }
      return { savedByOutlet, clearedRows }
    })

    let savedCount = parsed.clears.length
    for (const [outletId, saved] of result.savedByOutlet) {
      savedCount += saved.length
      const before = beforeByOutlet.get(outletId)
      await appendAvailabilityBulkAudit(tx, actor, deps, {
        outletId,
        reasonText,
        nowIso,
        saved,
        beforeData: (updatesByOutlet.get(outletId) ?? []).map((item) =>
          availSnapshot(before?.get(availabilityKey(item.productId, item.skuId)) ?? null),
        ),
      })
    }
    for (const row of result.clearedRows) {
      await appendAudit(
        tx,
        {
          action: 'availability.changed',
          entityType: 'item_outlet_availability',
          entityId: row.id,
          outletId: row.outletId,
          beforeData: availSnapshot(row),
          afterData: null,
          reasonText,
          actorUserId: actor.appUserId,
          occurredAt: nowIso,
        },
        { newId: () => newIdFrom(deps), nowIso: () => nowIso },
      )
    }
    return { savedCount, version }
  })
}
