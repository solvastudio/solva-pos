import '@tanstack/react-start/server-only'
import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import type { TaxRateRow } from '~/lib/sales-calc'
import type { TenantTx } from '~/server/db'
import {
  appUser,
  cashMaster,
  legalEntity,
  outlet,
  paymentMethod,
  registerInvoicePrefix,
  taxRateHistory,
} from './schema'
import { device, deviceSyncStatus } from './device-schema'

export async function getTaxRateHistory(
  tx: TenantTx,
  outletId: string,
): Promise<TaxRateRow[]> {
  const rows = await tx
    .select({
      id: taxRateHistory.id,
      taxCode: taxRateHistory.taxCode,
      outletId: taxRateHistory.outletId,
      rate: taxRateHistory.rate,
      effectiveFrom: taxRateHistory.effectiveFrom,
    })
    .from(taxRateHistory)
    .where(
      and(
        isNull(taxRateHistory.deletedAt),
        or(eq(taxRateHistory.outletId, outletId), isNull(taxRateHistory.outletId)),
      ),
    )

  return rows.map((r) => ({
    id: r.id,
    taxCode: r.taxCode as 'PPN' | 'PB1',
    outletId: r.outletId,
    rate: r.rate,
    effectiveFrom: r.effectiveFrom,
  }))
}

export async function findRegisterPrefixForBusinessDate(
  tx: TenantTx,
  tenantId: string,
  registerId: string,
  businessDate: string,
): Promise<string | null> {
  const yearMonthStart = `${businessDate.slice(0, 7)}-01`
  const rows = await tx
    .select({ invoicePrefix: registerInvoicePrefix.invoicePrefix })
    .from(registerInvoicePrefix)
    .where(
      and(
        eq(registerInvoicePrefix.tenantId, tenantId),
        eq(registerInvoicePrefix.registerId, registerId),
        lte(registerInvoicePrefix.effectiveMonth, yearMonthStart),
        isNull(registerInvoicePrefix.deletedAt),
      ),
    )
    .orderBy(desc(registerInvoicePrefix.effectiveMonth))
    .limit(1)
  return rows[0]?.invoicePrefix ?? null
}

export async function validateSaleIdentityRefs(
  tx: TenantTx,
  params: {
    tenantId: string
    userIds: readonly string[]
    legalEntityId: string
    paymentMethodIds: readonly string[]
  },
): Promise<{
  missingUserId: string | null
  missingLegalEntity: boolean
  missingMethodId: string | null
}> {
  const uniqueUsers = [...new Set(params.userIds)]
  if (uniqueUsers.length > 0) {
    const foundUsers = await tx
      .select({ id: appUser.id })
      .from(appUser)
      .where(and(eq(appUser.tenantId, params.tenantId), inArray(appUser.id, uniqueUsers)))
    const userSet = new Set(foundUsers.map((u) => u.id))
    for (const id of uniqueUsers) {
      if (!userSet.has(id)) {
        return { missingUserId: id, missingLegalEntity: false, missingMethodId: null }
      }
    }
  }

  const leRows = await tx
    .select({ id: legalEntity.id })
    .from(legalEntity)
    .where(and(eq(legalEntity.tenantId, params.tenantId), eq(legalEntity.id, params.legalEntityId)))
    .limit(1)
  if (leRows.length === 0) {
    return { missingUserId: null, missingLegalEntity: true, missingMethodId: null }
  }

  const uniqueMethods = [...new Set(params.paymentMethodIds)]
  if (uniqueMethods.length > 0) {
    const foundMethods = await tx
      .select({ id: paymentMethod.id })
      .from(paymentMethod)
      .where(
        and(eq(paymentMethod.tenantId, params.tenantId), inArray(paymentMethod.id, uniqueMethods)),
      )
    const methodSet = new Set(foundMethods.map((m) => m.id))
    for (const id of uniqueMethods) {
      if (!methodSet.has(id)) {
        return { missingUserId: null, missingLegalEntity: false, missingMethodId: id }
      }
    }
  }

  return { missingUserId: null, missingLegalEntity: false, missingMethodId: null }
}

export async function findMissingAppUserId(
  tx: TenantTx,
  tenantId: string,
  userIds: readonly string[],
): Promise<string | null> {
  const uniqueUsers = [...new Set(userIds)]
  if (uniqueUsers.length === 0) return null
  const found = await tx
    .select({ id: appUser.id })
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), inArray(appUser.id, uniqueUsers)))
  const set = new Set(found.map((u) => u.id))
  for (const id of uniqueUsers) {
    if (!set.has(id)) return id
  }
  return null
}

export async function findMissingPaymentMethodId(
  tx: TenantTx,
  tenantId: string,
  methodIds: readonly string[],
): Promise<string | null> {
  const uniqueIds = [...new Set(methodIds)]
  if (uniqueIds.length === 0) return null
  const found = await tx
    .select({ id: paymentMethod.id })
    .from(paymentMethod)
    .where(and(eq(paymentMethod.tenantId, tenantId), inArray(paymentMethod.id, uniqueIds)))
  const set = new Set(found.map((m) => m.id))
  for (const id of uniqueIds) {
    if (!set.has(id)) return id
  }
  return null
}

export async function getRegisterPendingCommandCount(
  tx: TenantTx,
  tenantId: string,
  registerId: string,
): Promise<number> {
  const rows = await tx
    .select({ pendingCount: deviceSyncStatus.pendingCount })
    .from(deviceSyncStatus)
    .innerJoin(
      device,
      and(eq(device.tenantId, deviceSyncStatus.tenantId), eq(device.id, deviceSyncStatus.deviceId)),
    )
    .where(
      and(
        eq(deviceSyncStatus.tenantId, tenantId),
        eq(deviceSyncStatus.registerId, registerId),
        isNull(device.revokedAt),
      ),
    )
    .limit(1)

  if (rows[0]) {
    return Number(rows[0].pendingCount)
  }

  // Fallback to latest device_sync_status row on this register if device was just revoked
  const fallback = await tx
    .select({ pendingCount: deviceSyncStatus.pendingCount })
    .from(deviceSyncStatus)
    .where(
      and(eq(deviceSyncStatus.tenantId, tenantId), eq(deviceSyncStatus.registerId, registerId)),
    )
    .orderBy(desc(deviceSyncStatus.lastAttemptAt))
    .limit(1)
  return fallback[0] ? Number(fallback[0].pendingCount) : 0
}

export async function getRegisterRecoveryContext(
  tx: TenantTx,
  tenantId: string,
  registerId: string,
): Promise<{
  registerId: string
  registerCode: string
  registerName: string
  outletId: string
  outletCode: string
  outletTimezone: string
  outletDayCutoffTime: string
  activeDeviceId: string | null
  latestDeviceId: string | null
} | null> {
  const regRows = await tx
    .select({
      registerId: cashMaster.id,
      registerCode: cashMaster.code,
      registerName: cashMaster.name,
      outletId: cashMaster.outletId,
      outletCode: outlet.code,
      outletTimezone: outlet.timezone,
      outletDayCutoffTime: outlet.dayCutoffTime,
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
        isNull(outlet.deletedAt),
      ),
    )
    .limit(1)

  const reg = regRows[0]
  if (!reg) return null

  const devRows = await tx
    .select({
      id: device.id,
      revokedAt: device.revokedAt,
    })
    .from(device)
    .where(and(eq(device.tenantId, tenantId), eq(device.registerId, registerId)))
    .orderBy(desc(device.enrolledAt))
    .limit(5)

  const active = devRows.find((d) => d.revokedAt === null)
  return {
    ...reg,
    activeDeviceId: active?.id ?? null,
    latestDeviceId: devRows[0]?.id ?? null,
  }
}
