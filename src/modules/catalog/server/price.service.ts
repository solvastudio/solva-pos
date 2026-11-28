import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { MoneyError, toNonNegMoney, type Money } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { parseOrThrow } from '~/server/parse-or-throw'
import { resolvePrice, type PriceResolution } from '../shared'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  requireCatalogView,
  type CatalogActor,
  type CatalogServiceDeps,
} from './auth'
import {
  findPriceEntryByKey,
  listActivePriceEntriesBySku,
  listActivePriceEntriesBySkuIds,
  listActivePriceEntriesForSkuUom,
  tombstonePriceEntryRow,
  upsertPriceEntryBatch,
  upsertPriceEntryRow,
  type PriceEntryRow,
} from './price.repo'
import { findProductById } from './product.repo'
import { findSkuUomBySkuAndUom, listSkuUomsBySkuIds } from './sku-uom.repo'
import { findSkuById } from './variant.repo'

const MAX_DETAILED_AUDIT_ITEMS = 200

const setPriceSchema = z.object({
  skuId: z.string().uuid(),
  uomId: z.string().uuid(),
  outletId: z.string().uuid().nullable().optional(),
  price: z.number(),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

const clearOutletPriceSchema = z.object({
  skuId: z.string().uuid(),
  uomId: z.string().uuid(),
  outletId: z.string().uuid(),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

const bulkPriceItemSchema = z.object({
  skuId: z.string().uuid(),
  uomId: z.string().uuid(),
  price: z.number(),
})

const setPricesBulkSchema = z.object({
  outletId: z.string().uuid().nullable().optional(),
  items: z.array(bulkPriceItemSchema).min(1).max(1000),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

const getEffectivePriceSchema = z.object({
  skuId: z.string().uuid(),
  uomId: z.string().uuid(),
  outletId: z.string().uuid(),
})

export type SetPriceInput = z.input<typeof setPriceSchema>
export type ClearOutletPriceInput = z.input<typeof clearOutletPriceSchema>
export type SetPricesBulkInput = z.input<typeof setPricesBulkSchema>
export type GetEffectivePriceInput = z.input<typeof getEffectivePriceSchema>

function assertValidMoney(rawPrice: number): Money {
  try {
    return toNonNegMoney(rawPrice)
  } catch (err) {
    if (err instanceof MoneyError) {
      throw new AppError('VALIDATION_FAILED', err.message)
    }
    throw err
  }
}

function priceSnapshot(row: PriceEntryRow | null): Record<string, unknown> | null {
  if (!row || row.deletedAt !== null) return null
  return {
    skuId: row.skuId,
    uomId: row.uomId,
    outletId: row.outletId,
    price: row.price,
    currency: row.currency,
  }
}

export async function listPricesForSku(actor: CatalogActor, rawSkuId: string): Promise<PriceEntryRow[]> {
  requireCatalogView(actor)
  const idRes = z.string().uuid().safeParse(rawSkuId)
  if (!idRes.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid SKU id')
  }
  return withTenantReadOnly(actor.tenantId, (tx) => listActivePriceEntriesBySku(tx, actor.tenantId, idRes.data))
}

export async function getEffectivePrice(
  actor: CatalogActor,
  rawInput: GetEffectivePriceInput,
): Promise<PriceResolution> {
  const parsed = parseOrThrow(getEffectivePriceSchema, rawInput, 'Invalid price lookup input')
  requireCatalogPermission(actor, { outletId: parsed.outletId })

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const skuRow = await findSkuById(tx, actor.tenantId, parsed.skuId)
    if (!skuRow) {
      throw new AppError('VALIDATION_FAILED', 'SKU not found')
    }
    const productRow = await findProductById(tx, actor.tenantId, skuRow.productId)
    if (!productRow) {
      throw new AppError('VALIDATION_FAILED', 'Product not found')
    }
    const skuUomRow = await findSkuUomBySkuAndUom(tx, actor.tenantId, parsed.skuId, parsed.uomId)
    if (!skuUomRow) {
      throw new AppError('VALIDATION_FAILED', 'SKU-UOM pair not found')
    }

    const entries = await listActivePriceEntriesForSkuUom(
      tx,
      actor.tenantId,
      parsed.skuId,
      parsed.uomId,
      parsed.outletId,
    )

    return resolvePrice({
      skuId: parsed.skuId,
      uomId: parsed.uomId,
      outletId: parsed.outletId,
      isOpenPrice: productRow.isOpenPrice,
      entries: entries.map((e) => ({
        skuId: e.skuId,
        uomId: e.uomId,
        outletId: e.outletId,
        price: toNonNegMoney(e.price),
        deleted: e.deletedAt !== null,
      })),
    })
  })
}

export async function setPrice(
  actor: CatalogActor,
  rawInput: SetPriceInput,
  deps?: CatalogServiceDeps,
): Promise<PriceEntryRow> {
  const parsed = parseOrThrow(setPriceSchema, rawInput, 'Invalid price input')
  const outletId = parsed.outletId ?? null
  if (outletId === null) {
    requireCatalogPermission(actor, { requireTenantWide: true })
  } else {
    requireCatalogPermission(actor, { outletId })
  }
  const validPrice = assertValidMoney(parsed.price)
  const reasonText = parsed.reasonText?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const skuUomRow = await findSkuUomBySkuAndUom(tx, actor.tenantId, parsed.skuId, parsed.uomId)
    if (!skuUomRow) {
      throw new AppError('VALIDATION_FAILED', 'Active SKU-UOM pair not found')
    }

    const { existing, saved } = await writeMaster(
      tx,
      { actorUserId: actor.appUserId },
      async (w) => {
        const current = await findPriceEntryByKey(tx, actor.tenantId, {
          skuId: parsed.skuId,
          uomId: parsed.uomId,
          outletId,
        })
        const row = await upsertPriceEntryRow(tx, w, {
          id: current?.id ?? newIdFrom(deps),
          skuId: parsed.skuId,
          uomId: parsed.uomId,
          outletId,
          price: validPrice,
          currency: 'IDR',
          nowIso,
        })
        return { existing: current, saved: row }
      },
    ).then((r) => r.result)

    await appendAudit(
      tx,
      {
        action: 'price.changed',
        entityType: 'price_entry',
        entityId: saved.id,
        outletId,
        beforeData: priceSnapshot(existing),
        afterData: priceSnapshot(saved),
        reasonText,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => newIdFrom(deps), nowIso: () => nowIso },
    )

    return saved
  })
}

export async function clearOutletPrice(
  actor: CatalogActor,
  rawInput: ClearOutletPriceInput,
  deps?: CatalogServiceDeps,
): Promise<{ id: string | null }> {
  const parsed = parseOrThrow(clearOutletPriceSchema, rawInput, 'Invalid clear outlet price input')
  requireCatalogPermission(actor, { outletId: parsed.outletId })
  const reasonText = parsed.reasonText?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findPriceEntryByKey(tx, actor.tenantId, {
      skuId: parsed.skuId,
      uomId: parsed.uomId,
      outletId: parsed.outletId,
    })
    if (!existing || existing.deletedAt !== null) {
      return { id: null }
    }
    const beforeData = priceSnapshot(existing)

    const { result } = await writeMaster(tx, { actorUserId: actor.appUserId }, (w) =>
      tombstonePriceEntryRow(tx, w, existing.id, nowIso),
    )

    await appendAudit(
      tx,
      {
        action: 'price.changed',
        entityType: 'price_entry',
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

    return { id: result?.id ?? existing.id }
  })
}

interface ValidatedPriceItem {
  skuId: string
  uomId: string
  price: Money
}

function priceKey(skuId: string, uomId: string): string {
  return `${skuId}:${uomId}`
}

/** Throws unless every (sku, uom) pair has an active `sku_uom` row. One query per 1000 SKUs. */
async function assertActiveSkuUomPairs(
  tx: TenantTx,
  tenantId: string,
  items: readonly ValidatedPriceItem[],
): Promise<void> {
  const rows = await listSkuUomsBySkuIds(tx, tenantId, [...new Set(items.map((i) => i.skuId))])
  const active = new Set(rows.map((r) => priceKey(r.skuId, r.uomId)))
  for (const item of items) {
    if (!active.has(priceKey(item.skuId, item.uomId))) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Active SKU-UOM pair not found (${item.skuId}, ${item.uomId})`,
      )
    }
  }
}

/** Active price rows of one outlet (`null` = default price), keyed by `skuId:uomId`. */
async function loadActivePricesByKey(
  tx: TenantTx,
  tenantId: string,
  outletId: string | null,
  skuIds: readonly string[],
): Promise<Map<string, PriceEntryRow>> {
  const rows = await listActivePriceEntriesBySkuIds(tx, tenantId, [...new Set(skuIds)])
  const map = new Map<string, PriceEntryRow>()
  for (const r of rows) {
    if (r.outletId === outletId) map.set(priceKey(r.skuId, r.uomId), r)
  }
  return map
}

/** Last occurrence wins, matching the former one-by-one upsert loop. */
function dedupePriceItems(items: readonly ValidatedPriceItem[]): ValidatedPriceItem[] {
  const unique = new Map<string, ValidatedPriceItem>()
  for (const item of items) unique.set(priceKey(item.skuId, item.uomId), item)
  return [...unique.values()]
}

async function appendPriceBulkAudit(
  tx: TenantTx,
  actor: CatalogActor,
  deps: CatalogServiceDeps | undefined,
  params: {
    outletId: string | null
    reasonText: string | null
    nowIso: string
    result: readonly PriceEntryRow[]
    beforeMap: ReadonlyMap<string, PriceEntryRow>
  },
): Promise<void> {
  const { outletId, reasonText, nowIso, result, beforeMap } = params
  const auditSlice = result.slice(0, MAX_DETAILED_AUDIT_ITEMS)
  for (const row of auditSlice) {
    await appendAudit(
      tx,
      {
        action: 'price.changed',
        entityType: 'price_entry',
        entityId: row.id,
        outletId,
        beforeData: priceSnapshot(beforeMap.get(priceKey(row.skuId, row.uomId)) ?? null),
        afterData: priceSnapshot(row),
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
        action: 'price.changed',
        entityType: 'price_entry',
        entityId: outletId,
        outletId,
        beforeData: null,
        afterData: {
          batch: true,
          outletId,
          totalCount: result.length,
          auditedDetailCount: auditSlice.length,
        },
        reasonText,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => newIdFrom(deps), nowIso: () => nowIso },
    )
  }
}

export async function setPricesBulk(
  actor: CatalogActor,
  rawInput: SetPricesBulkInput,
  deps?: CatalogServiceDeps,
): Promise<{ entries: PriceEntryRow[]; version: number }> {
  const parsed = parseOrThrow(setPricesBulkSchema, rawInput, 'Invalid bulk price input')
  const outletId = parsed.outletId ?? null
  if (outletId === null) {
    requireCatalogPermission(actor, { requireTenantWide: true })
  } else {
    requireCatalogPermission(actor, { outletId })
  }

  const validatedItems = parsed.items.map((item) => ({
    skuId: item.skuId,
    uomId: item.uomId,
    price: assertValidMoney(item.price),
  }))
  const reasonText = parsed.reasonText?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    await assertActiveSkuUomPairs(tx, actor.tenantId, validatedItems)
    const beforeMap = await loadActivePricesByKey(
      tx,
      actor.tenantId,
      outletId,
      validatedItems.map((i) => i.skuId),
    )
    const uniqueItems = dedupePriceItems(validatedItems)

    const { version, result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await upsertPriceEntryBatch(
        tx,
        w,
        uniqueItems.map((item) => ({
          id: newIdFrom(deps),
          skuId: item.skuId,
          uomId: item.uomId,
          outletId,
          price: item.price,
          currency: 'IDR',
          nowIso,
        })),
      )
      const saved = await loadActivePricesByKey(
        tx,
        actor.tenantId,
        outletId,
        uniqueItems.map((i) => i.skuId),
      )
      return uniqueItems.map((item) => saved.get(priceKey(item.skuId, item.uomId))!)
    })

    await appendPriceBulkAudit(tx, actor, deps, { outletId, reasonText, nowIso, result, beforeMap })
    return { entries: result, version }
  })
}

const setPricesAcrossOutletsSchema = z.object({
  entries: z
    .array(
      z.object({
        skuId: z.string().uuid(),
        uomId: z.string().uuid(),
        outletId: z.string().uuid().nullable().optional(),
        price: z.number(),
      }),
    )
    .min(1)
    .max(5000),
  reasonText: z.string().trim().max(200).nullable().optional(),
})

export type SetPricesAcrossOutletsInput = z.input<typeof setPricesAcrossOutletsSchema>

/**
 * All-or-nothing price save for several outlets: one transaction and one master version.
 * `writeMaster` may run only once per transaction, so every outlet is written inside the same call.
 */
export async function setPricesAcrossOutlets(
  actor: CatalogActor,
  rawInput: SetPricesAcrossOutletsInput,
  deps?: CatalogServiceDeps,
): Promise<{ savedCount: number; version: number }> {
  const parsed = parseOrThrow(setPricesAcrossOutletsSchema, rawInput, 'Invalid price save input')

  const itemsByOutlet = new Map<string | null, ValidatedPriceItem[]>()
  for (const entry of parsed.entries) {
    const outletId = entry.outletId ?? null
    const list = itemsByOutlet.get(outletId) ?? []
    list.push({ skuId: entry.skuId, uomId: entry.uomId, price: assertValidMoney(entry.price) })
    itemsByOutlet.set(outletId, list)
  }
  for (const outletId of itemsByOutlet.keys()) {
    if (outletId === null) {
      requireCatalogPermission(actor, { requireTenantWide: true })
    } else {
      requireCatalogPermission(actor, { outletId })
    }
  }
  const reasonText = parsed.reasonText?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const plans: Array<{
      outletId: string | null
      items: ValidatedPriceItem[]
      beforeMap: Map<string, PriceEntryRow>
    }> = []
    for (const [outletId, rawItems] of itemsByOutlet) {
      await assertActiveSkuUomPairs(tx, actor.tenantId, rawItems)
      plans.push({
        outletId,
        items: dedupePriceItems(rawItems),
        beforeMap: await loadActivePricesByKey(
          tx,
          actor.tenantId,
          outletId,
          rawItems.map((i) => i.skuId),
        ),
      })
    }

    const { version, result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await upsertPriceEntryBatch(
        tx,
        w,
        plans.flatMap((plan) =>
          plan.items.map((item) => ({
            id: newIdFrom(deps),
            skuId: item.skuId,
            uomId: item.uomId,
            outletId: plan.outletId,
            price: item.price,
            currency: 'IDR',
            nowIso,
          })),
        ),
      )
      const savedPerPlan: PriceEntryRow[][] = []
      for (const plan of plans) {
        const saved = await loadActivePricesByKey(
          tx,
          actor.tenantId,
          plan.outletId,
          plan.items.map((i) => i.skuId),
        )
        savedPerPlan.push(plan.items.map((item) => saved.get(priceKey(item.skuId, item.uomId))!))
      }
      return savedPerPlan
    })

    let savedCount = 0
    for (let i = 0; i < plans.length; i += 1) {
      const rows = result[i]!
      savedCount += rows.length
      await appendPriceBulkAudit(tx, actor, deps, {
        outletId: plans[i]!.outletId,
        reasonText,
        nowIso,
        result: rows,
        beforeMap: plans[i]!.beforeMap,
      })
    }
    return { savedCount, version }
  })
}
