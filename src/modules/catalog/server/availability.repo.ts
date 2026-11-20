import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import type { AvailabilityStatus } from '../shared'
import { chunkArray } from './chunk'
import { itemOutletAvailability } from './schema'

export interface AvailabilityRow {
  id: string
  outletId: string
  productId: string
  skuId: string | null
  status: AvailabilityStatus
  changedAt: string
  changedBy: string | null
  version: number
  deletedAt: string | null
}

const availabilitySelect = {
  id: itemOutletAvailability.id,
  outletId: itemOutletAvailability.outletId,
  productId: itemOutletAvailability.productId,
  skuId: itemOutletAvailability.skuId,
  status: itemOutletAvailability.status,
  changedAt: itemOutletAvailability.changedAt,
  changedBy: itemOutletAvailability.changedBy,
  version: itemOutletAvailability.version,
  deletedAt: itemOutletAvailability.deletedAt,
}

function toAvailabilityRow(
  row: Omit<AvailabilityRow, 'status'> & { status: string },
): AvailabilityRow {
  return {
    ...row,
    status: row.status as AvailabilityStatus,
  }
}

export async function listActiveOutletIds(tx: TenantTx, tenantId: string): Promise<string[]> {
  const res = await tx.execute(
    sql`SELECT id FROM outlet WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL ORDER BY id ASC`,
  )
  return res.rows
    .map((r) => (r as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string')
}

export async function listActiveOutletsWithCodes(
  tx: TenantTx,
  tenantId: string,
): Promise<Array<{ id: string; code: string }>> {
  const res = await tx.execute(
    sql`SELECT id, code FROM outlet WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL ORDER BY code ASC, id ASC`,
  )
  return res.rows.map((r) => {
    const row = r as { id: string; code: string }
    return { id: String(row.id), code: String(row.code) }
  })
}

export async function listAvailabilityByProductIds(
  tx: TenantTx,
  tenantId: string,
  productIds: readonly string[],
): Promise<AvailabilityRow[]> {
  if (productIds.length === 0) return []
  const out: AvailabilityRow[] = []
  for (const batch of chunkArray(productIds)) {
    const rows = await tx
      .select(availabilitySelect)
      .from(itemOutletAvailability)
      .where(
        and(
          eq(itemOutletAvailability.tenantId, tenantId),
          inArray(itemOutletAvailability.productId, batch),
          isNull(itemOutletAvailability.deletedAt),
        ),
      )
    out.push(...rows.map(toAvailabilityRow))
  }
  return out
}

export async function listAvailabilityForOutlet(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
  productIds?: readonly string[],
): Promise<AvailabilityRow[]> {
  const conditions = [
    eq(itemOutletAvailability.tenantId, tenantId),
    eq(itemOutletAvailability.outletId, outletId),
    isNull(itemOutletAvailability.deletedAt),
  ]
  if (productIds && productIds.length > 0) {
    conditions.push(inArray(itemOutletAvailability.productId, productIds))
  }
  const rows = await tx
    .select(availabilitySelect)
    .from(itemOutletAvailability)
    .where(and(...conditions))
    .orderBy(asc(itemOutletAvailability.productId), asc(itemOutletAvailability.id))
  return rows.map(toAvailabilityRow)
}

export async function findAvailabilityRow(
  tx: TenantTx,
  tenantId: string,
  key: { outletId: string; productId: string; skuId: string | null },
): Promise<AvailabilityRow | null> {
  const skuCond =
    key.skuId === null
      ? isNull(itemOutletAvailability.skuId)
      : eq(itemOutletAvailability.skuId, key.skuId)
  const rows = await tx
    .select(availabilitySelect)
    .from(itemOutletAvailability)
    .where(
      and(
        eq(itemOutletAvailability.tenantId, tenantId),
        eq(itemOutletAvailability.outletId, key.outletId),
        eq(itemOutletAvailability.productId, key.productId),
        skuCond,
      ),
    )
    .limit(1)
  return rows[0] ? toAvailabilityRow(rows[0]) : null
}

export async function upsertAvailabilityRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    outletId: string
    productId: string
    skuId: string | null
    status: AvailabilityStatus
    nowIso: string
  },
): Promise<AvailabilityRow> {
  const rows = await tx
    .insert(itemOutletAvailability)
    .values({
      id: params.id,
      tenantId: w.tenantId,
      version: w.version,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
      deletedAt: null,
      outletId: params.outletId,
      productId: params.productId,
      skuId: params.skuId,
      status: params.status,
      changedAt: params.nowIso,
      changedBy: w.actorUserId,
    })
    .onConflictDoUpdate({
      target: [
        itemOutletAvailability.outletId,
        itemOutletAvailability.productId,
        itemOutletAvailability.skuId,
      ],
      set: {
        status: params.status,
        changedAt: params.nowIso,
        changedBy: w.actorUserId,
        deletedAt: null,
        version: w.version,
        updatedAt: params.nowIso,
        updatedBy: w.actorUserId,
      },
    })
    .returning(availabilitySelect)
  return toAvailabilityRow(rows[0]!)
}

export async function tombstoneAvailabilityRow(
  tx: TenantTx,
  w: MasterWriter,
  id: string,
  nowIso: string,
): Promise<AvailabilityRow | null> {
  const rows = await tx
    .update(itemOutletAvailability)
    .set({
      deletedAt: nowIso,
      changedAt: nowIso,
      changedBy: w.actorUserId,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(itemOutletAvailability.tenantId, w.tenantId),
        eq(itemOutletAvailability.id, id),
        isNull(itemOutletAvailability.deletedAt),
      ),
    )
    .returning(availabilitySelect)
  return rows[0] ? toAvailabilityRow(rows[0]) : null
}

export async function tombstoneAvailabilityForProduct(
  tx: TenantTx,
  w: MasterWriter,
  productId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(itemOutletAvailability)
    .set({
      deletedAt: nowIso,
      changedAt: nowIso,
      changedBy: w.actorUserId,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(itemOutletAvailability.tenantId, w.tenantId),
        eq(itemOutletAvailability.productId, productId),
        isNull(itemOutletAvailability.deletedAt),
      ),
    )
}

export async function tombstoneAvailabilityForSku(
  tx: TenantTx,
  w: MasterWriter,
  skuId: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(itemOutletAvailability)
    .set({
      deletedAt: nowIso,
      changedAt: nowIso,
      changedBy: w.actorUserId,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(itemOutletAvailability.tenantId, w.tenantId),
        eq(itemOutletAvailability.skuId, skuId),
        isNull(itemOutletAvailability.deletedAt),
      ),
    )
}

/**
 * Set-based seed for all active products into a newly created outlet inside the caller's
 * `writeMaster` transaction (single SQL statement, never an N+1 JS loop).
 */
export async function createDefaultAvailabilityForOutlet(
  tx: TenantTx,
  w: MasterWriter,
  outletId: string,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO item_outlet_availability (
      id,
      tenant_id,
      version,
      created_at,
      updated_at,
      created_by,
      updated_by,
      deleted_at,
      outlet_id,
      product_id,
      sku_id,
      status,
      changed_at,
      changed_by
    )
    SELECT
      uuidv7(),
      ${w.tenantId}::uuid,
      ${w.version},
      ${nowIso}::timestamptz,
      ${nowIso}::timestamptz,
      ${w.actorUserId}::uuid,
      ${w.actorUserId}::uuid,
      NULL,
      ${outletId}::uuid,
      p.id,
      NULL,
      'AVAILABLE',
      ${nowIso}::timestamptz,
      ${w.actorUserId}::uuid
    FROM product p
    WHERE p.tenant_id = ${w.tenantId}::uuid
      AND p.is_active = true
      AND p.deleted_at IS NULL
    ON CONFLICT ON CONSTRAINT uq_item_outlet_avail__outlet_prod_sku DO NOTHING
  `)
}

export async function upsertAvailabilityBatch(
  tx: TenantTx,
  w: MasterWriter,
  items: ReadonlyArray<{
    id: string
    outletId: string
    productId: string
    skuId: string | null
    status: AvailabilityStatus
    nowIso: string
  }>,
): Promise<void> {
  for (const batch of chunkArray(items)) {
    await tx
      .insert(itemOutletAvailability)
      .values(
        batch.map((p) => ({
          id: p.id,
          tenantId: w.tenantId,
          version: w.version,
          createdAt: p.nowIso,
          updatedAt: p.nowIso,
          createdBy: w.actorUserId,
          updatedBy: w.actorUserId,
          deletedAt: null,
          outletId: p.outletId,
          productId: p.productId,
          skuId: p.skuId,
          status: p.status,
          changedAt: p.nowIso,
          changedBy: w.actorUserId,
        })),
      )
      .onConflictDoUpdate({
        target: [
          itemOutletAvailability.outletId,
          itemOutletAvailability.productId,
          itemOutletAvailability.skuId,
        ],
        set: {
          status: sql`excluded.status`,
          changedAt: sql`excluded.changed_at`,
          changedBy: w.actorUserId,
          deletedAt: null,
          version: w.version,
          updatedAt: sql`excluded.updated_at`,
          updatedBy: w.actorUserId,
        },
      })
  }
}

export async function insertDefaultAvailabilityForProductsBatch(
  tx: TenantTx,
  w: MasterWriter,
  productIds: readonly string[],
  outletIds: readonly string[],
  nowIso: string,
): Promise<void> {
  if (productIds.length === 0 || outletIds.length === 0) return
  const outletSqlList = sql.join(
    outletIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )
  for (const prodBatch of chunkArray(productIds)) {
    const prodSqlList = sql.join(
      prodBatch.map((id) => sql`${id}::uuid`),
      sql`, `,
    )
    await tx.execute(sql`
      INSERT INTO item_outlet_availability (
        id,
        tenant_id,
        version,
        created_at,
        updated_at,
        created_by,
        updated_by,
        deleted_at,
        outlet_id,
        product_id,
        sku_id,
        status,
        changed_at,
        changed_by
      )
      SELECT
        uuidv7(),
        ${w.tenantId}::uuid,
        ${w.version}::bigint,
        ${nowIso}::timestamptz,
        ${nowIso}::timestamptz,
        ${w.actorUserId}::uuid,
        ${w.actorUserId}::uuid,
        NULL,
        o.oid,
        p.pid,
        NULL,
        'AVAILABLE',
        ${nowIso}::timestamptz,
        ${w.actorUserId}::uuid
      FROM unnest(ARRAY[${outletSqlList}]) AS o(oid)
      CROSS JOIN unnest(ARRAY[${prodSqlList}]) AS p(pid)
      ON CONFLICT ON CONSTRAINT uq_item_outlet_avail__outlet_prod_sku DO NOTHING
    `)
  }
}
