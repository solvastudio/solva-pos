import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { cashMaster, outlet, registerInvoicePrefix } from './schema'

export interface RegisterDbRow {
  id: string
  outletId: string
  outletCode: string
  outletName: string
  outletTimezone: string
  outletDayCutoffTime: string
  code: string
  name: string
  status: string
  registerType: string
  paperWidthMm: number
  defaultLocale: string | null
  version: number
}

export interface RegisterPrefixDbRow {
  id: string
  registerId: string
  effectiveMonth: string
  invoicePrefix: string
}

export async function listRegistersRows(
  tx: TenantTx,
  tenantId: string,
  allowedOutletIds: readonly string[] | null,
): Promise<RegisterDbRow[]> {
  if (Array.isArray(allowedOutletIds) && allowedOutletIds.length === 0) {
    return []
  }

  const conditions = [eq(cashMaster.tenantId, tenantId), isNull(cashMaster.deletedAt)]
  if (Array.isArray(allowedOutletIds)) {
    conditions.push(inArray(cashMaster.outletId, [...allowedOutletIds]))
  }

  return tx
    .select({
      id: cashMaster.id,
      outletId: cashMaster.outletId,
      outletCode: outlet.code,
      outletName: outlet.name,
      outletTimezone: outlet.timezone,
      outletDayCutoffTime: outlet.dayCutoffTime,
      code: cashMaster.code,
      name: cashMaster.name,
      status: cashMaster.status,
      registerType: cashMaster.registerType,
      paperWidthMm: cashMaster.paperWidthMm,
      defaultLocale: cashMaster.defaultLocale,
      version: cashMaster.version,
    })
    .from(cashMaster)
    .innerJoin(
      outlet,
      and(eq(outlet.tenantId, cashMaster.tenantId), eq(outlet.id, cashMaster.outletId)),
    )
    .where(and(...conditions))
    .orderBy(asc(outlet.code), asc(cashMaster.code))
}

export async function listPrefixRowsForRegisters(
  tx: TenantTx,
  tenantId: string,
  registerIds: readonly string[],
): Promise<RegisterPrefixDbRow[]> {
  if (registerIds.length === 0) {
    return []
  }
  return tx
    .select({
      id: registerInvoicePrefix.id,
      registerId: registerInvoicePrefix.registerId,
      effectiveMonth: registerInvoicePrefix.effectiveMonth,
      invoicePrefix: registerInvoicePrefix.invoicePrefix,
    })
    .from(registerInvoicePrefix)
    .where(
      and(
        eq(registerInvoicePrefix.tenantId, tenantId),
        inArray(registerInvoicePrefix.registerId, [...registerIds]),
        isNull(registerInvoicePrefix.deletedAt),
      ),
    )
    .orderBy(asc(registerInvoicePrefix.effectiveMonth))
}

export async function findRegisterById(
  tx: TenantTx,
  tenantId: string,
  registerId: string,
): Promise<RegisterDbRow | null> {
  const rows = await tx
    .select({
      id: cashMaster.id,
      outletId: cashMaster.outletId,
      outletCode: outlet.code,
      outletName: outlet.name,
      outletTimezone: outlet.timezone,
      outletDayCutoffTime: outlet.dayCutoffTime,
      code: cashMaster.code,
      name: cashMaster.name,
      status: cashMaster.status,
      registerType: cashMaster.registerType,
      paperWidthMm: cashMaster.paperWidthMm,
      defaultLocale: cashMaster.defaultLocale,
      version: cashMaster.version,
    })
    .from(cashMaster)
    .innerJoin(
      outlet,
      and(eq(outlet.tenantId, cashMaster.tenantId), eq(outlet.id, cashMaster.outletId)),
    )
    .where(
      and(
        eq(cashMaster.tenantId, tenantId),
        eq(cashMaster.id, registerId),
        isNull(cashMaster.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function findRegisterByOutletAndCode(
  tx: TenantTx,
  tenantId: string,
  outletId: string,
  code: string,
): Promise<{ id: string } | null> {
  const rows = await tx
    .select({ id: cashMaster.id })
    .from(cashMaster)
    .where(
      and(
        eq(cashMaster.tenantId, tenantId),
        eq(cashMaster.outletId, outletId),
        eq(cashMaster.code, code),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

/**
 * Finds whether any non-deleted prefix record in the tenant uses `prefix`.
 * Returns its owner `registerId` so callers can reject cross-register collisions.
 */
export async function findPrefixOwner(
  tx: TenantTx,
  tenantId: string,
  prefix: string,
): Promise<{ id: string; registerId: string } | null> {
  const rows = await tx
    .select({
      id: registerInvoicePrefix.id,
      registerId: registerInvoicePrefix.registerId,
    })
    .from(registerInvoicePrefix)
    .where(
      and(
        eq(registerInvoicePrefix.tenantId, tenantId),
        eq(registerInvoicePrefix.invoicePrefix, prefix),
        isNull(registerInvoicePrefix.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function insertRegisterAndPrefixRows(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    registerId: string
    outletId: string
    code: string
    name: string
    registerType: string
    paperWidthMm: number
    defaultLocale: string | null
    prefixRow: {
      id: string
      effectiveMonth: string
      invoicePrefix: string
    } | null
    nowIso: string
  },
): Promise<void> {
  await tx.insert(cashMaster).values({
    id: params.registerId,
    tenantId: writer.tenantId,
    outletId: params.outletId,
    code: params.code,
    name: params.name,
    status: 'ACTIVE',
    registerType: params.registerType,
    paperWidthMm: params.paperWidthMm,
    defaultLocale: params.defaultLocale,
    version: writer.version,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    createdBy: writer.actorUserId,
    updatedBy: writer.actorUserId,
  })

  if (params.prefixRow) {
    await tx.insert(registerInvoicePrefix).values({
      id: params.prefixRow.id,
      tenantId: writer.tenantId,
      registerId: params.registerId,
      effectiveMonth: params.prefixRow.effectiveMonth,
      invoicePrefix: params.prefixRow.invoicePrefix,
      version: writer.version,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: writer.actorUserId,
      updatedBy: writer.actorUserId,
    })
  }
}

export async function updateRegisterRow(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    id: string
    name: string
    status: string
    paperWidthMm: number
    defaultLocale: string | null
    nowIso: string
  },
): Promise<void> {
  await tx
    .update(cashMaster)
    .set({
      name: params.name,
      status: params.status,
      paperWidthMm: params.paperWidthMm,
      defaultLocale: params.defaultLocale,
      version: writer.version,
      updatedAt: params.nowIso,
      updatedBy: writer.actorUserId,
    })
    .where(
      and(
        eq(cashMaster.tenantId, writer.tenantId),
        eq(cashMaster.id, params.id),
        isNull(cashMaster.deletedAt),
      ),
    )
}

export async function upsertNextMonthPrefixRow(
  tx: TenantTx,
  writer: MasterWriter,
  params: {
    newRowId: string
    registerId: string
    effectiveMonth: string
    invoicePrefix: string
    nowIso: string
  },
): Promise<string> {
  const existing = await tx
    .select({ id: registerInvoicePrefix.id })
    .from(registerInvoicePrefix)
    .where(
      and(
        eq(registerInvoicePrefix.tenantId, writer.tenantId),
        eq(registerInvoicePrefix.registerId, params.registerId),
        eq(registerInvoicePrefix.effectiveMonth, params.effectiveMonth),
      ),
    )
    .limit(1)

  if (existing[0]) {
    await tx
      .update(registerInvoicePrefix)
      .set({
        invoicePrefix: params.invoicePrefix,
        deletedAt: null,
        version: writer.version,
        updatedAt: params.nowIso,
        updatedBy: writer.actorUserId,
      })
      .where(
        and(
          eq(registerInvoicePrefix.tenantId, writer.tenantId),
          eq(registerInvoicePrefix.id, existing[0].id),
        ),
      )
    return existing[0].id
  }

  await tx.insert(registerInvoicePrefix).values({
    id: params.newRowId,
    tenantId: writer.tenantId,
    registerId: params.registerId,
    effectiveMonth: params.effectiveMonth,
    invoicePrefix: params.invoicePrefix,
    version: writer.version,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    createdBy: writer.actorUserId,
    updatedBy: writer.actorUserId,
  })
  return params.newRowId
}
