import '@tanstack/react-start/server-only'
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import {
  businessDate,
  isUuid,
  type OutletTimezone,
} from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import {
  addTaxRateSchema,
  savePaymentMethodSchema,
  updateOutletTaxSettingsSchema,
  updateReceiptSettingSchema,
  type OutletReceiptSettingView,
  type OutletTaxSettingsView,
  type PaymentMethodView,
  type TaxRateHistoryView,
} from '../shared'
import {
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import { findLegalEntityById } from './legal-entity.repo'
import {
  legalEntity,
  outlet,
  outletReceiptSetting,
  paymentMethod,
  taxRateHistory,
} from './schema'

function nowIso(deps?: IdentityServiceDeps): string {
  return (deps?.nowIso ?? (() => new Date().toISOString()))()
}

function formatRateStr(raw: string | number): string {
  const num = Number(raw)
  return Number.isFinite(num) ? String(num) : String(raw)
}

export async function getOutletFullSettings(
  actor: IdentityAuthActor,
  outletId: string,
): Promise<{
  tax: OutletTaxSettingsView
  receipt: OutletReceiptSettingView | null
  taxRates: TaxRateHistoryView[]
  paymentMethods: PaymentMethodView[]
}> {
  requireActorPermission(actor, 'org.manage', { outletId })
  if (!isUuid(outletId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid outletId')
  }

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const outletRows = await tx
      .select({
        id: outlet.id,
        legalEntityId: outlet.legalEntityId,
        taxProfile: outlet.taxProfile,
        priceTaxMode: outlet.priceTaxMode,
        cashRoundingUnit: outlet.cashRoundingUnit,
        serviceChargeEnabled: outlet.serviceChargeEnabled,
        serviceChargeRate: outlet.serviceChargeRate,
        serviceChargeTaxable: outlet.serviceChargeTaxable,
        timezone: outlet.timezone,
        dayCutoffTime: outlet.dayCutoffTime,
        version: outlet.version,
        legalEntityIsPkp: legalEntity.isPkp,
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
        and(eq(outlet.tenantId, actor.tenantId), eq(outlet.id, outletId), isNull(outlet.deletedAt)),
      )
      .limit(1)

    const row = outletRows[0]
    if (!row) {
      throw new AppError('VALIDATION_FAILED', 'Outlet not found')
    }

    const receiptRows = await tx
      .select({
        id: outletReceiptSetting.id,
        outletId: outletReceiptSetting.outletId,
        receiptLocale: outletReceiptSetting.receiptLocale,
        headerText: outletReceiptSetting.headerText,
        footerText: outletReceiptSetting.footerText,
        logoSha256: outletReceiptSetting.logoSha256,
        version: outletReceiptSetting.version,
      })
      .from(outletReceiptSetting)
      .where(
        and(
          eq(outletReceiptSetting.tenantId, actor.tenantId),
          eq(outletReceiptSetting.outletId, outletId),
          isNull(outletReceiptSetting.deletedAt),
        ),
      )
      .limit(1)

    const rateRows = await tx
      .select({
        id: taxRateHistory.id,
        taxCode: taxRateHistory.taxCode,
        outletId: taxRateHistory.outletId,
        effectiveFrom: taxRateHistory.effectiveFrom,
        rate: taxRateHistory.rate,
        version: taxRateHistory.version,
      })
      .from(taxRateHistory)
      .where(
        and(
          eq(taxRateHistory.tenantId, actor.tenantId),
          isNull(taxRateHistory.deletedAt),
          or(isNull(taxRateHistory.outletId), eq(taxRateHistory.outletId, outletId)),
        ),
      )
      .orderBy(desc(taxRateHistory.effectiveFrom), asc(taxRateHistory.taxCode))

    const pmRows = await tx
      .select({
        id: paymentMethod.id,
        code: paymentMethod.code,
        name: paymentMethod.name,
        kind: paymentMethod.kind,
        requiresReference: paymentMethod.requiresReference,
        sortOrder: paymentMethod.sortOrder,
        isActive: paymentMethod.isActive,
        version: paymentMethod.version,
      })
      .from(paymentMethod)
      .where(and(eq(paymentMethod.tenantId, actor.tenantId), isNull(paymentMethod.deletedAt)))
      .orderBy(asc(paymentMethod.sortOrder), asc(paymentMethod.code))

    const receipt = receiptRows[0] ?? null
    return {
      tax: {
        outletId: row.id,
        legalEntityIsPkp: row.legalEntityIsPkp,
        taxProfile: row.taxProfile as OutletTaxSettingsView['taxProfile'],
        priceTaxMode: row.priceTaxMode as OutletTaxSettingsView['priceTaxMode'],
        cashRoundingUnit: row.cashRoundingUnit as OutletTaxSettingsView['cashRoundingUnit'],
        serviceChargeEnabled: row.serviceChargeEnabled,
        serviceChargeRate: formatRateStr(row.serviceChargeRate),
        serviceChargeTaxable: row.serviceChargeTaxable,
        timezone: row.timezone,
        dayCutoffTime: row.dayCutoffTime.slice(0, 5),
        version: row.version,
      },
      receipt: receipt
        ? {
            ...receipt,
            receiptLocale: receipt.receiptLocale === 'en-US' ? 'en-US' : 'id-ID',
          }
        : null,
      taxRates: rateRows.map((r) => ({
        id: r.id,
        taxCode: r.taxCode === 'PB1' ? 'PB1' : 'PPN',
        outletId: r.outletId,
        effectiveFrom: r.effectiveFrom,
        rate: formatRateStr(r.rate),
        version: r.version,
      })),
      paymentMethods: pmRows.map((pm) => ({
        ...pm,
        kind: pm.kind === 'CASH' ? 'CASH' : 'NON_CASH',
      })),
    }
  })
}

export async function updateOutletTaxSettings(
  actor: IdentityAuthActor,
  rawInput: unknown,
  deps?: IdentityServiceDeps,
): Promise<{ version: number }> {
  const input = updateOutletTaxSettingsSchema.parse(rawInput)
  requireActorPermission(actor, 'org.manage', { outletId: input.outletId })

  const rateNum = Number(input.serviceChargeRate)
  if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) {
    throw new AppError('VALIDATION_FAILED', 'serviceChargeRate must be between 0 and 100')
  }
  const effectiveServiceRate = input.serviceChargeEnabled ? String(rateNum) : '0'
  const ts = nowIso(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existingRows = await tx
      .select({
        id: outlet.id,
        legalEntityId: outlet.legalEntityId,
        taxProfile: outlet.taxProfile,
        priceTaxMode: outlet.priceTaxMode,
        cashRoundingUnit: outlet.cashRoundingUnit,
        serviceChargeEnabled: outlet.serviceChargeEnabled,
        serviceChargeRate: outlet.serviceChargeRate,
        serviceChargeTaxable: outlet.serviceChargeTaxable,
      })
      .from(outlet)
      .where(
        and(eq(outlet.tenantId, actor.tenantId), eq(outlet.id, input.outletId), isNull(outlet.deletedAt)),
      )
      .limit(1)

    const current = existingRows[0]
    if (!current) {
      throw new AppError('VALIDATION_FAILED', 'Outlet not found')
    }

    const le = await findLegalEntityById(tx, actor.tenantId, current.legalEntityId)
    if (input.taxProfile === 'PPN' && !le?.isPkp) {
      throw new AppError(
        'VALIDATION_FAILED',
        'PPN tax profile requires a PKP-registered legal entity',
      )
    }

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tx
        .update(outlet)
        .set({
          taxProfile: input.taxProfile,
          priceTaxMode: input.priceTaxMode,
          cashRoundingUnit: input.cashRoundingUnit,
          serviceChargeEnabled: input.serviceChargeEnabled,
          serviceChargeRate: effectiveServiceRate,
          serviceChargeTaxable: input.serviceChargeTaxable,
          version: w.version,
          updatedAt: ts,
        })
        .where(and(eq(outlet.tenantId, actor.tenantId), eq(outlet.id, input.outletId)))

      await appendAudit(
        tx,
        {
          action: 'outlet.changed',
          entityType: 'outlet',
          entityId: input.outletId,
          outletId: input.outletId,
          actorUserId: actor.appUserId,
          occurredAt: ts,
          beforeData: {
            tax_profile: current.taxProfile,
            price_tax_mode: current.priceTaxMode,
            cash_rounding_unit: current.cashRoundingUnit,
            service_charge_enabled: current.serviceChargeEnabled,
            service_charge_rate: formatRateStr(current.serviceChargeRate),
            service_charge_taxable: current.serviceChargeTaxable,
          },
          afterData: {
            tax_profile: input.taxProfile,
            price_tax_mode: input.priceTaxMode,
            cash_rounding_unit: input.cashRoundingUnit,
            service_charge_enabled: input.serviceChargeEnabled,
            service_charge_rate: effectiveServiceRate,
            service_charge_taxable: input.serviceChargeTaxable,
          },
        },
        { newId: () => identityIdGen.newId(), nowIso: () => ts },
      )
      return true
    })

    return { version }
  })
}

export async function addTaxRate(
  actor: IdentityAuthActor,
  rawInput: unknown,
  deps?: IdentityServiceDeps,
): Promise<{ id: string; version: number }> {
  const input = addTaxRateSchema.parse(rawInput)
  if (input.outletId) {
    requireActorPermission(actor, 'org.manage', { outletId: input.outletId })
  } else {
    requireActorPermission(actor, 'org.manage')
    if (actor.outletIds !== null) {
      throw new AppError('FORBIDDEN', 'Only tenant-wide owners can create global default tax rates')
    }
  }

  const rateNum = Number(input.rate)
  if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) {
    throw new AppError('VALIDATION_FAILED', 'Tax rate must be between 0 and 100')
  }

  const ts = nowIso(deps)

  return withTenant(actor.tenantId, async (tx) => {
    let tz: OutletTimezone = 'Asia/Jakarta'
    let cutoff = '00:00'
    if (input.outletId) {
      const outRows = await tx
        .select({ timezone: outlet.timezone, dayCutoffTime: outlet.dayCutoffTime })
        .from(outlet)
        .where(
          and(
            eq(outlet.tenantId, actor.tenantId),
            eq(outlet.id, input.outletId),
            isNull(outlet.deletedAt),
          ),
        )
        .limit(1)
      if (!outRows[0]) {
        throw new AppError('VALIDATION_FAILED', 'Outlet not found')
      }
      tz = outRows[0].timezone as OutletTimezone
      cutoff = outRows[0].dayCutoffTime.slice(0, 5)
    }

    const todayBDate = businessDate(ts, tz, cutoff)
    if (input.effectiveFrom < todayBDate) {
      throw new AppError(
        'VALIDATION_FAILED',
        `effective_from ${input.effectiveFrom} cannot be before today (${todayBDate})`,
      )
    }

    const duplicate = await tx
      .select({ id: taxRateHistory.id })
      .from(taxRateHistory)
      .where(
        and(
          eq(taxRateHistory.tenantId, actor.tenantId),
          eq(taxRateHistory.taxCode, input.taxCode),
          input.outletId
            ? eq(taxRateHistory.outletId, input.outletId)
            : isNull(taxRateHistory.outletId),
          eq(taxRateHistory.effectiveFrom, input.effectiveFrom),
        ),
      )
      .limit(1)

    if (duplicate[0]) {
      throw new AppError(
        'VALIDATION_FAILED',
        'A tax rate already exists for that effective date; historical rows cannot be overwritten',
      )
    }

    const newId = identityIdGen.newId()
    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tx.insert(taxRateHistory).values({
        id: newId,
        tenantId: actor.tenantId,
        taxCode: input.taxCode,
        outletId: input.outletId,
        effectiveFrom: input.effectiveFrom,
        rate: String(rateNum),
        version: w.version,
        createdAt: ts,
        updatedAt: ts,
      })

      await appendAudit(
        tx,
        {
          action: 'tax_rate.changed',
          entityType: 'tax_rate_history',
          entityId: newId,
          outletId: input.outletId,
          actorUserId: actor.appUserId,
          occurredAt: ts,
          afterData: {
            tax_code: input.taxCode,
            outlet_id: input.outletId,
            effective_from: input.effectiveFrom,
            rate: String(rateNum),
          },
        },
        { newId: () => identityIdGen.newId(), nowIso: () => ts },
      )
      return true
    })

    return { id: newId, version }
  })
}

export async function updateReceiptSetting(
  actor: IdentityAuthActor,
  rawInput: unknown,
  deps?: IdentityServiceDeps,
): Promise<{ id: string; version: number }> {
  const input = updateReceiptSettingSchema.parse(rawInput)
  requireActorPermission(actor, 'org.manage', { outletId: input.outletId })

  const headerText = input.headerText?.trim() ? input.headerText.trim() : null
  const footerText = input.footerText?.trim() ? input.footerText.trim() : null
  const ts = nowIso(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const outCheck = await tx
      .select({ id: outlet.id })
      .from(outlet)
      .where(
        and(eq(outlet.tenantId, actor.tenantId), eq(outlet.id, input.outletId), isNull(outlet.deletedAt)),
      )
      .limit(1)
    if (!outCheck[0]) {
      throw new AppError('VALIDATION_FAILED', 'Outlet not found')
    }

    const existingRows = await tx
      .select({
        id: outletReceiptSetting.id,
        receiptLocale: outletReceiptSetting.receiptLocale,
        headerText: outletReceiptSetting.headerText,
        footerText: outletReceiptSetting.footerText,
      })
      .from(outletReceiptSetting)
      .where(
        and(
          eq(outletReceiptSetting.tenantId, actor.tenantId),
          eq(outletReceiptSetting.outletId, input.outletId),
        ),
      )
      .limit(1)

    const existing = existingRows[0]
    const settingId = existing?.id ?? identityIdGen.newId()

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      if (existing) {
        await tx
          .update(outletReceiptSetting)
          .set({
            receiptLocale: input.receiptLocale,
            headerText,
            footerText,
            version: w.version,
            updatedAt: ts,
          })
          .where(
            and(
              eq(outletReceiptSetting.tenantId, actor.tenantId),
              eq(outletReceiptSetting.id, existing.id),
            ),
          )
      } else {
        await tx.insert(outletReceiptSetting).values({
          id: settingId,
          tenantId: actor.tenantId,
          outletId: input.outletId,
          receiptLocale: input.receiptLocale,
          headerText,
          footerText,
          version: w.version,
          createdAt: ts,
          updatedAt: ts,
        })
      }

      await appendAudit(
        tx,
        {
          action: 'outlet.changed',
          entityType: 'outlet_receipt_setting',
          entityId: settingId,
          outletId: input.outletId,
          actorUserId: actor.appUserId,
          occurredAt: ts,
          beforeData: existing
            ? {
                receipt_locale: existing.receiptLocale,
                has_header: Boolean(existing.headerText),
                has_footer: Boolean(existing.footerText),
              }
            : null,
          afterData: {
            receipt_locale: input.receiptLocale,
            has_header: Boolean(headerText),
            has_footer: Boolean(footerText),
          },
        },
        { newId: () => identityIdGen.newId(), nowIso: () => ts },
      )
      return true
    })

    return { id: settingId, version }
  })
}

export async function listPaymentMethods(actor: IdentityAuthActor): Promise<PaymentMethodView[]> {
  requireActorPermission(actor, 'org.manage')
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: paymentMethod.id,
        code: paymentMethod.code,
        name: paymentMethod.name,
        kind: paymentMethod.kind,
        requiresReference: paymentMethod.requiresReference,
        sortOrder: paymentMethod.sortOrder,
        isActive: paymentMethod.isActive,
        version: paymentMethod.version,
      })
      .from(paymentMethod)
      .where(and(eq(paymentMethod.tenantId, actor.tenantId), isNull(paymentMethod.deletedAt)))
      .orderBy(asc(paymentMethod.sortOrder), asc(paymentMethod.code))

    return rows.map((r) => ({
      ...r,
      kind: r.kind === 'CASH' ? 'CASH' : 'NON_CASH',
    }))
  })
}

export async function savePaymentMethod(
  actor: IdentityAuthActor,
  rawInput: unknown,
  deps?: IdentityServiceDeps,
): Promise<{ id: string; version: number }> {
  requireActorPermission(actor, 'org.manage')
  if (actor.outletIds !== null) {
    throw new AppError('FORBIDDEN', 'Only tenant-wide owners can manage tenant payment methods')
  }

  const input = savePaymentMethodSchema.parse(rawInput)
  const ts = nowIso(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const allMethods = await tx
      .select({
        id: paymentMethod.id,
        code: paymentMethod.code,
        name: paymentMethod.name,
        kind: paymentMethod.kind,
        isActive: paymentMethod.isActive,
      })
      .from(paymentMethod)
      .where(and(eq(paymentMethod.tenantId, actor.tenantId), isNull(paymentMethod.deletedAt)))

    const existing = input.id ? allMethods.find((m) => m.id === input.id) : null
    if (input.id && !existing) {
      throw new AppError('VALIDATION_FAILED', 'Payment method not found')
    }

    const otherCash = allMethods.find((m) => m.kind === 'CASH' && m.id !== input.id)
    if (input.kind === 'CASH' && otherCash) {
      throw new AppError('VALIDATION_FAILED', 'Only one active CASH payment method is permitted')
    }
    if (input.kind === 'CASH' && !input.isActive) {
      throw new AppError('VALIDATION_FAILED', 'Cannot deactivate the sole active CASH method')
    }
    if (existing && existing.kind === 'CASH' && input.kind !== 'CASH') {
      throw new AppError('VALIDATION_FAILED', 'Cannot change the sole CASH method to NON_CASH')
    }

    const codeDup = allMethods.find((m) => m.code === input.code && m.id !== input.id)
    if (codeDup) {
      throw new AppError('VALIDATION_FAILED', `Payment method code ${input.code} already exists`)
    }

    const pmId = existing?.id ?? identityIdGen.newId()
    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      if (existing) {
        await tx
          .update(paymentMethod)
          .set({
            code: input.code,
            name: input.name,
            kind: input.kind,
            requiresReference: input.requiresReference,
            sortOrder: input.sortOrder,
            isActive: input.isActive,
            version: w.version,
            updatedAt: ts,
          })
          .where(and(eq(paymentMethod.tenantId, actor.tenantId), eq(paymentMethod.id, existing.id)))
      } else {
        await tx.insert(paymentMethod).values({
          id: pmId,
          tenantId: actor.tenantId,
          code: input.code,
          name: input.name,
          kind: input.kind,
          requiresReference: input.requiresReference,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
          version: w.version,
          createdAt: ts,
          updatedAt: ts,
        })
      }

      await appendAudit(
        tx,
        {
          action: 'outlet.changed',
          entityType: 'payment_method',
          entityId: pmId,
          actorUserId: actor.appUserId,
          occurredAt: ts,
          beforeData: existing
            ? { code: existing.code, kind: existing.kind, is_active: existing.isActive }
            : null,
          afterData: {
            code: input.code,
            name: input.name,
            kind: input.kind,
            is_active: input.isActive,
          },
        },
        { newId: () => identityIdGen.newId(), nowIso: () => ts },
      )
      return true
    })

    return { id: pmId, version }
  })
}
