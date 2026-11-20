import '@tanstack/react-start/server-only'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { product, skuUom, uom } from './schema'

export interface UomRow {
  id: string
  code: string
  name: string
  allowFraction: boolean
  version: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

const uomSelect = {
  id: uom.id,
  code: uom.code,
  name: uom.name,
  allowFraction: uom.allowFraction,
  version: uom.version,
  deletedAt: uom.deletedAt,
  createdAt: uom.createdAt,
  updatedAt: uom.updatedAt,
}

export async function findUomById(tx: TenantTx, tenantId: string, id: string): Promise<UomRow | null> {
  const rows = await tx
    .select(uomSelect)
    .from(uom)
    .where(and(eq(uom.tenantId, tenantId), eq(uom.id, id), isNull(uom.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function listUoms(tx: TenantTx, tenantId: string): Promise<UomRow[]> {
  return tx
    .select(uomSelect)
    .from(uom)
    .where(and(eq(uom.tenantId, tenantId), isNull(uom.deletedAt)))
    .orderBy(asc(uom.code), asc(uom.id))
}

export async function isUomReferencedByActiveProductOrSkuUom(
  tx: TenantTx,
  tenantId: string,
  uomId: string,
): Promise<boolean> {
  const prodRef = await tx
    .select({ id: product.id })
    .from(product)
    .where(and(eq(product.tenantId, tenantId), eq(product.baseUomId, uomId), isNull(product.deletedAt)))
    .limit(1)
  if (prodRef.length > 0) return true

  const skuUomRef = await tx
    .select({ id: skuUom.id })
    .from(skuUom)
    .where(
      and(
        eq(skuUom.tenantId, tenantId),
        or(eq(skuUom.uomId, uomId)),
        isNull(skuUom.deletedAt),
      ),
    )
    .limit(1)
  return skuUomRef.length > 0
}

export async function insertUomRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    code: string
    name: string
    allowFraction: boolean
    nowIso: string
  },
): Promise<UomRow> {
  const rows = await tx
    .insert(uom)
    .values({
      id: params.id,
      tenantId: w.tenantId,
      version: w.version,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
      deletedAt: null,
      code: params.code,
      name: params.name,
      allowFraction: params.allowFraction,
    })
    .returning(uomSelect)
  return rows[0]!
}

export async function updateUomRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    code?: string
    name?: string
    allowFraction?: boolean
    nowIso: string
  },
): Promise<UomRow | null> {
  const rows = await tx
    .update(uom)
    .set({
      ...(params.code !== undefined ? { code: params.code } : {}),
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.allowFraction !== undefined ? { allowFraction: params.allowFraction } : {}),
      version: w.version,
      updatedAt: params.nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(uom.tenantId, w.tenantId), eq(uom.id, params.id), isNull(uom.deletedAt)))
    .returning(uomSelect)
  return rows[0] ?? null
}

export async function tombstoneUomRow(
  tx: TenantTx,
  w: MasterWriter,
  id: string,
  nowIso: string,
): Promise<boolean> {
  const rows = await tx
    .update(uom)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(and(eq(uom.tenantId, w.tenantId), eq(uom.id, id), isNull(uom.deletedAt)))
    .returning({ id: uom.id })
  return rows.length > 0
}
