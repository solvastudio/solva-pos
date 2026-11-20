import '@tanstack/react-start/server-only'
import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import type { TaxRateRow } from '~/lib/sales-calc'
import type { TenantTx } from '~/server/db'
import {
  appUser,
  legalEntity,
  paymentMethod,
  registerInvoicePrefix,
  taxRateHistory,
} from './schema'

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
