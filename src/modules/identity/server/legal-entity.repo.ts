import '@tanstack/react-start/server-only'
import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { legalEntity, outlet } from './schema'

export interface LegalEntityDbRow {
  id: string
  name: string
  npwp: string | null
  isPkp: boolean
  pkpSince: string | null
  address: string | null
  version: number
}

export async function listLegalEntitiesRows(
  tx: TenantTx,
  tenantId: string,
): Promise<LegalEntityDbRow[]> {
  return tx
    .select({
      id: legalEntity.id,
      name: legalEntity.name,
      npwp: legalEntity.npwp,
      isPkp: legalEntity.isPkp,
      pkpSince: legalEntity.pkpSince,
      address: legalEntity.address,
      version: legalEntity.version,
    })
    .from(legalEntity)
    .where(and(eq(legalEntity.tenantId, tenantId), isNull(legalEntity.deletedAt)))
    .orderBy(asc(legalEntity.createdAt), asc(legalEntity.name))
}

export async function findLegalEntityById(
  tx: TenantTx,
  tenantId: string,
  id: string,
): Promise<LegalEntityDbRow | null> {
  const rows = await tx
    .select({
      id: legalEntity.id,
      name: legalEntity.name,
      npwp: legalEntity.npwp,
      isPkp: legalEntity.isPkp,
      pkpSince: legalEntity.pkpSince,
      address: legalEntity.address,
      version: legalEntity.version,
    })
    .from(legalEntity)
    .where(
      and(
        eq(legalEntity.tenantId, tenantId),
        eq(legalEntity.id, id),
        isNull(legalEntity.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function findLegalEntityByNpwp(
  tx: TenantTx,
  tenantId: string,
  npwp: string,
  excludeId?: string,
): Promise<{ id: string } | null> {
  const conditions = [
    eq(legalEntity.tenantId, tenantId),
    eq(legalEntity.npwp, npwp),
    isNull(legalEntity.deletedAt),
  ]
  if (excludeId) {
    conditions.push(ne(legalEntity.id, excludeId))
  }
  const rows = await tx
    .select({ id: legalEntity.id })
    .from(legalEntity)
    .where(and(...conditions))
    .limit(1)
  return rows[0] ?? null
}

export async function hasPpnOutletForLegalEntity(
  tx: TenantTx,
  tenantId: string,
  legalEntityId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: outlet.id })
    .from(outlet)
    .where(
      and(
        eq(outlet.tenantId, tenantId),
        eq(outlet.legalEntityId, legalEntityId),
        eq(outlet.taxProfile, 'PPN'),
        isNull(outlet.deletedAt),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export async function insertLegalEntityRow(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    id: string
    name: string
    npwp: string | null
    isPkp: boolean
    pkpSince: string | null
    address: string | null
    nowIso: string
  },
): Promise<void> {
  await tx.insert(legalEntity).values({
    id: params.id,
    tenantId: writer.tenantId,
    name: params.name,
    npwp: params.npwp,
    isPkp: params.isPkp,
    pkpSince: params.pkpSince,
    address: params.address,
    version: writer.version,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    createdBy: writer.actorUserId,
    updatedBy: writer.actorUserId,
  })
}

export async function updateLegalEntityRow(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    id: string
    name: string
    npwp: string | null
    isPkp: boolean
    pkpSince: string | null
    address: string | null
    nowIso: string
  },
): Promise<void> {
  await tx
    .update(legalEntity)
    .set({
      name: params.name,
      npwp: params.npwp,
      isPkp: params.isPkp,
      pkpSince: params.pkpSince,
      address: params.address,
      version: writer.version,
      updatedAt: params.nowIso,
      updatedBy: writer.actorUserId,
    })
    .where(
      and(
        eq(legalEntity.tenantId, writer.tenantId),
        eq(legalEntity.id, params.id),
        isNull(legalEntity.deletedAt),
      ),
    )
}
