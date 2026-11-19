import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { legalEntity, outlet, outletReceiptSetting } from './schema'

export interface OutletDbRow {
  id: string
  legalEntityId: string
  legalEntityName: string
  code: string
  name: string
  address: string | null
  phone: string | null
  timezone: string
  dayCutoffTime: string
  priceTaxMode: string
  taxProfile: string
  isActive: boolean
  version: number
}

export async function listOutletsRows(
  tx: TenantTx,
  tenantId: string,
  allowedOutletIds: readonly string[] | null,
): Promise<OutletDbRow[]> {
  if (Array.isArray(allowedOutletIds) && allowedOutletIds.length === 0) {
    return []
  }

  const conditions = [eq(outlet.tenantId, tenantId), isNull(outlet.deletedAt)]
  if (Array.isArray(allowedOutletIds)) {
    conditions.push(inArray(outlet.id, [...allowedOutletIds]))
  }

  return tx
    .select({
      id: outlet.id,
      legalEntityId: outlet.legalEntityId,
      legalEntityName: legalEntity.name,
      code: outlet.code,
      name: outlet.name,
      address: outlet.address,
      phone: outlet.phone,
      timezone: outlet.timezone,
      dayCutoffTime: outlet.dayCutoffTime,
      priceTaxMode: outlet.priceTaxMode,
      taxProfile: outlet.taxProfile,
      isActive: outlet.isActive,
      version: outlet.version,
    })
    .from(outlet)
    .innerJoin(
      legalEntity,
      and(
        eq(legalEntity.tenantId, outlet.tenantId),
        eq(legalEntity.id, outlet.legalEntityId),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(outlet.code), asc(outlet.name))
}

export async function findOutletById(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
): Promise<OutletDbRow | null> {
  const rows = await tx
    .select({
      id: outlet.id,
      legalEntityId: outlet.legalEntityId,
      legalEntityName: legalEntity.name,
      code: outlet.code,
      name: outlet.name,
      address: outlet.address,
      phone: outlet.phone,
      timezone: outlet.timezone,
      dayCutoffTime: outlet.dayCutoffTime,
      priceTaxMode: outlet.priceTaxMode,
      taxProfile: outlet.taxProfile,
      isActive: outlet.isActive,
      version: outlet.version,
    })
    .from(outlet)
    .innerJoin(
      legalEntity,
      and(
        eq(legalEntity.tenantId, outlet.tenantId),
        eq(legalEntity.id, outlet.legalEntityId),
      ),
    )
    .where(
      and(
        eq(outlet.tenantId, tenantId),
        eq(outlet.id, outletId),
        isNull(outlet.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function findOutletByCode(
  tx: TenantTx,
  tenantId: string,
  code: string,
): Promise<{ id: string } | null> {
  const rows = await tx
    .select({ id: outlet.id })
    .from(outlet)
    .where(and(eq(outlet.tenantId, tenantId), eq(outlet.code, code)))
    .limit(1)
  return rows[0] ?? null
}

export async function insertOutletAndReceiptSettingRows(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    outletId: string
    receiptSettingId: string
    legalEntityId: string
    code: string
    name: string
    address: string | null
    phone: string | null
    timezone: string
    dayCutoffTime: string
    priceTaxMode: string
    taxProfile: string
    nowIso: string
  },
): Promise<void> {
  await tx.insert(outlet).values({
    id: params.outletId,
    tenantId: writer.tenantId,
    legalEntityId: params.legalEntityId,
    code: params.code,
    name: params.name,
    address: params.address,
    phone: params.phone,
    timezone: params.timezone,
    dayCutoffTime: params.dayCutoffTime,
    priceTaxMode: params.priceTaxMode,
    taxProfile: params.taxProfile,
    isActive: true,
    version: writer.version,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    createdBy: writer.actorUserId,
    updatedBy: writer.actorUserId,
  })

  await tx.insert(outletReceiptSetting).values({
    id: params.receiptSettingId,
    tenantId: writer.tenantId,
    outletId: params.outletId,
    receiptLocale: 'id-ID',
    version: writer.version,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    createdBy: writer.actorUserId,
    updatedBy: writer.actorUserId,
  })
}

export async function updateOutletRow(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    id: string
    name: string
    address: string | null
    phone: string | null
    timezone: string
    dayCutoffTime: string
    isActive: boolean
    nowIso: string
  },
): Promise<void> {
  await tx
    .update(outlet)
    .set({
      name: params.name,
      address: params.address,
      phone: params.phone,
      timezone: params.timezone,
      dayCutoffTime: params.dayCutoffTime,
      isActive: params.isActive,
      version: writer.version,
      updatedAt: params.nowIso,
      updatedBy: writer.actorUserId,
    })
    .where(
      and(
        eq(outlet.tenantId, writer.tenantId),
        eq(outlet.id, params.id),
        isNull(outlet.deletedAt),
      ),
    )
}
