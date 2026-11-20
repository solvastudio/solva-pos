import type { CashRoundingUnit } from '~/lib/kernel'
import { selectTaxRate, type SaleConfigSnapshot, type TaxRateRow } from '~/lib/sales-calc'
import type { SolvaDb } from '../db/solva-db'
import type { OutletRecord, TaxRateHistoryRecord } from '../db/types'
import { getOutlet, listTaxRateHistory } from '../data/master.repo'

export type ConfigSnapshotResult =
  | {
      readonly ok: true
      readonly config: SaleConfigSnapshot
      readonly cashRoundingUnit: CashRoundingUnit
      readonly taxRateId: string | null
    }
  | { readonly ok: false; readonly reason: 'OUTLET_NOT_FOUND' | 'TAX_RATE_NOT_CONFIGURED' }

function normalizeRoundingUnit(raw: number | undefined): CashRoundingUnit {
  if (raw === 0 || raw === 100 || raw === 500 || raw === 1000) return raw
  return 100
}

/**
 * Pure resolution of `SaleConfigSnapshot` from outlet + `tax_rate_history` rows at `businessDate`.
 * Rejects PPN/PB1 outlets when no active tax rate covers `businessDate` (EC-025).
 */
export function resolveOutletConfigSnapshot(input: {
  outlet: OutletRecord | null
  taxRates: readonly TaxRateHistoryRecord[]
  businessDate: string
}): ConfigSnapshotResult {
  const outlet = input.outlet
  if (!outlet || outlet.deleted_at) {
    return { ok: false, reason: 'OUTLET_NOT_FOUND' }
  }

  const priceTaxMode = outlet.price_tax_mode === 'INCLUSIVE' ? 'INCLUSIVE' : 'EXCLUSIVE'
  const rawTaxProfile = outlet.tax_profile
  const taxProfile: 'NONE' | 'PPN' | 'PB1' =
    rawTaxProfile === 'PPN' || rawTaxProfile === 'PB1' ? rawTaxProfile : 'NONE'

  let taxRate = '0'
  let taxRateId: string | null = null

  if (taxProfile === 'PPN' || taxProfile === 'PB1') {
    const history: TaxRateRow[] = input.taxRates
      .filter((r) => !r.deleted_at && (r.tax_code === 'PPN' || r.tax_code === 'PB1'))
      .map((r) => ({
        id: r.id,
        taxCode: r.tax_code as 'PPN' | 'PB1',
        outletId: r.outlet_id,
        rate: String(r.rate),
        effectiveFrom: r.effective_from,
        deleted: Boolean(r.deleted_at),
      }))

    const selected = selectTaxRate(history, taxProfile, outlet.id, input.businessDate)
    if (!selected) {
      return { ok: false, reason: 'TAX_RATE_NOT_CONFIGURED' }
    }
    taxRate = selected.rate
    taxRateId = selected.rowId
  }

  const serviceChargeEnabled = Boolean(outlet.service_charge_enabled)
  const serviceChargeRate = serviceChargeEnabled ? String(outlet.service_charge_rate ?? '0') : '0'
  const serviceChargeTaxable = outlet.service_charge_taxable ?? true

  return {
    ok: true,
    cashRoundingUnit: normalizeRoundingUnit(outlet.cash_rounding_unit),
    taxRateId,
    config: {
      priceTaxMode,
      taxProfile,
      taxRate,
      serviceChargeEnabled,
      serviceChargeRate,
      serviceChargeTaxable,
    },
  }
}

export async function buildConfigSnapshot(
  db: SolvaDb,
  input: { outletId: string; businessDate: string },
): Promise<ConfigSnapshotResult> {
  const [outlet, taxRates] = await Promise.all([
    getOutlet(db, input.outletId),
    listTaxRateHistory(db),
  ])
  return resolveOutletConfigSnapshot({
    outlet,
    taxRates,
    businessDate: input.businessDate,
  })
}
