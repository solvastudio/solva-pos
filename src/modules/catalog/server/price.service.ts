import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { MoneyError, toNonNegMoney, type Money } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { resolvePrice, type PriceResolution } from '../shared'
import {
  newIdFrom,
  nowIsoFrom,
  requireCatalogPermission,
  type CatalogActor,
  type CatalogServiceDeps,
} from './auth'
import {
  findPriceEntryByKey,
  listActivePriceEntriesBySku,
  listActivePriceEntriesForSkuUom,
  tombstonePriceEntryRow,
  upsertPriceEntryRow,
  type PriceEntryRow,
} from './price.repo'
import { findProductById } from './product.repo'
import { findSkuUomBySkuAndUom } from './sku-uom.repo'
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
  requireCatalogPermission(actor)
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
  const parsedRes = getEffectivePriceSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid price lookup input',
    )
  }
  const parsed = parsedRes.data
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
  const parsedRes = setPriceSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid price input',
    )
  }
  const parsed = parsedRes.data
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
  const parsedRes = clearOutletPriceSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid clear outlet price input',
    )
  }
  const parsed = parsedRes.data
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

export async function setPricesBulk(
  actor: CatalogActor,
  rawInput: SetPricesBulkInput,
  deps?: CatalogServiceDeps,
): Promise<{ entries: PriceEntryRow[]; version: number }> {
  const parsedRes = setPricesBulkSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid bulk price input',
    )
  }
  const parsed = parsedRes.data
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
    const beforeMap = new Map<string, Record<string, unknown> | null>()
    const existingIdMap = new Map<string, string>()

    for (const item of validatedItems) {
      const skuUomRow = await findSkuUomBySkuAndUom(tx, actor.tenantId, item.skuId, item.uomId)
      if (!skuUomRow) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Active SKU-UOM pair not found (${item.skuId}, ${item.uomId})`,
        )
      }
      const existing = await findPriceEntryByKey(tx, actor.tenantId, {
        skuId: item.skuId,
        uomId: item.uomId,
        outletId,
      })
      const key = `${item.skuId}:${item.uomId}`
      beforeMap.set(key, priceSnapshot(existing))
      if (existing) {
        existingIdMap.set(key, existing.id)
      }
    }

    const { version, result } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      const saved: PriceEntryRow[] = []
      for (const item of validatedItems) {
        const key = `${item.skuId}:${item.uomId}`
        const row = await upsertPriceEntryRow(tx, w, {
          id: existingIdMap.get(key) ?? newIdFrom(deps),
          skuId: item.skuId,
          uomId: item.uomId,
          outletId,
          price: item.price,
          currency: 'IDR',
          nowIso,
        })
        saved.push(row)
      }
      return saved
    })

    const auditSlice = result.slice(0, MAX_DETAILED_AUDIT_ITEMS)
    for (const row of auditSlice) {
      const key = `${row.skuId}:${row.uomId}`
      await appendAudit(
        tx,
        {
          action: 'price.changed',
          entityType: 'price_entry',
          entityId: row.id,
          outletId,
          beforeData: beforeMap.get(key) ?? null,
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

    return { entries: result, version }
  })
}
