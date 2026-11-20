import '@tanstack/react-start/server-only'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { priceEntry } from './schema'

export interface PriceEntryRow {
  id: string
  skuId: string
  uomId: string
  outletId: string | null
  price: number
  currency: string
  version: number
  deletedAt: string | null
}

const priceEntrySelect = {
  id: priceEntry.id,
  skuId: priceEntry.skuId,
  uomId: priceEntry.uomId,
  outletId: priceEntry.outletId,
  price: priceEntry.price,
  currency: priceEntry.currency,
  version: priceEntry.version,
  deletedAt: priceEntry.deletedAt,
}

export async function findPriceEntryByKey(
  tx: TenantTx,
  tenantId: string,
  key: { skuId: string; uomId: string; outletId: string | null },
): Promise<PriceEntryRow | null> {
  const outletCond =
    key.outletId === null ? isNull(priceEntry.outletId) : eq(priceEntry.outletId, key.outletId)
  const rows = await tx
    .select(priceEntrySelect)
    .from(priceEntry)
    .where(
      and(
        eq(priceEntry.tenantId, tenantId),
        eq(priceEntry.skuId, key.skuId),
        eq(priceEntry.uomId, key.uomId),
        outletCond,
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function listActivePriceEntriesForSkuUom(
  tx: TenantTx,
  tenantId: string,
  skuId: string,
  uomId: string,
  outletId: string | null,
): Promise<PriceEntryRow[]> {
  const outletCond =
    outletId === null
      ? isNull(priceEntry.outletId)
      : or(eq(priceEntry.outletId, outletId), isNull(priceEntry.outletId))

  return tx
    .select(priceEntrySelect)
    .from(priceEntry)
    .where(
      and(
        eq(priceEntry.tenantId, tenantId),
        eq(priceEntry.skuId, skuId),
        eq(priceEntry.uomId, uomId),
        isNull(priceEntry.deletedAt),
        outletCond,
      ),
    )
    .orderBy(asc(priceEntry.id))
}

export async function listActivePriceEntriesBySku(
  tx: TenantTx,
  tenantId: string,
  skuId: string,
): Promise<PriceEntryRow[]> {
  return tx
    .select(priceEntrySelect)
    .from(priceEntry)
    .where(and(eq(priceEntry.tenantId, tenantId), eq(priceEntry.skuId, skuId), isNull(priceEntry.deletedAt)))
    .orderBy(asc(priceEntry.uomId), asc(priceEntry.id))
}

export async function upsertPriceEntryRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    skuId: string
    uomId: string
    outletId: string | null
    price: number
    currency: string
    nowIso: string
  },
): Promise<PriceEntryRow> {
  const rows = await tx
    .insert(priceEntry)
    .values({
      id: params.id,
      tenantId: w.tenantId,
      version: w.version,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
      deletedAt: null,
      skuId: params.skuId,
      uomId: params.uomId,
      outletId: params.outletId,
      price: params.price,
      currency: params.currency,
    })
    .onConflictDoUpdate({
      target: [priceEntry.tenantId, priceEntry.skuId, priceEntry.uomId, priceEntry.outletId],
      set: {
        price: params.price,
        currency: params.currency,
        deletedAt: null,
        version: w.version,
        updatedAt: params.nowIso,
        updatedBy: w.actorUserId,
      },
    })
    .returning(priceEntrySelect)
  return rows[0]!
}

export async function tombstonePriceEntryRow(
  tx: TenantTx,
  w: MasterWriter,
  id: string,
  nowIso: string,
): Promise<PriceEntryRow | null> {
  const rows = await tx
    .update(priceEntry)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(priceEntry.tenantId, w.tenantId), eq(priceEntry.id, id), isNull(priceEntry.deletedAt)))
    .returning(priceEntrySelect)
  return rows[0] ?? null
}

export async function tombstonePriceEntriesForSkuUom(
  tx: TenantTx,
  w: MasterWriter,
  skuId: string,
  uomId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(priceEntry)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(priceEntry.tenantId, w.tenantId),
        eq(priceEntry.skuId, skuId),
        eq(priceEntry.uomId, uomId),
        isNull(priceEntry.deletedAt),
      ),
    )
}

export async function tombstonePriceEntriesForSku(
  tx: TenantTx,
  w: MasterWriter,
  skuId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(priceEntry)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(eq(priceEntry.tenantId, w.tenantId), eq(priceEntry.skuId, skuId), isNull(priceEntry.deletedAt)),
    )
}
