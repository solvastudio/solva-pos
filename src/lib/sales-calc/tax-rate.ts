import type { TaxRateRow } from './types'

/**
 * Resolves the effective tax rate for `(taxCode, outletId, businessDate)` per `docs/SCHEMA.md` §4.1.4:
 * outlet override rows with `effectiveFrom <= businessDate` win over tenant-default (`outletId === null`) rows,
 * picking the most recent `effectiveFrom` in each tier. Returns `null` if no valid rule exists.
 */
export function selectTaxRate(
  history: readonly TaxRateRow[],
  taxCode: 'PPN' | 'PB1',
  outletId: string,
  businessDate: string,
): { rate: string; rowId: string } | null {
  let outletMatch: TaxRateRow | null = null
  let defaultMatch: TaxRateRow | null = null

  for (const row of history) {
    if (row.deleted) continue
    if (row.taxCode !== taxCode) continue
    if (row.effectiveFrom > businessDate) continue

    if (row.outletId === outletId) {
      if (
        !outletMatch ||
        row.effectiveFrom > outletMatch.effectiveFrom ||
        (row.effectiveFrom === outletMatch.effectiveFrom && row.id > outletMatch.id)
      ) {
        outletMatch = row
      }
    } else if (row.outletId === null) {
      if (
        !defaultMatch ||
        row.effectiveFrom > defaultMatch.effectiveFrom ||
        (row.effectiveFrom === defaultMatch.effectiveFrom && row.id > defaultMatch.id)
      ) {
        defaultMatch = row
      }
    }
  }

  const winner = outletMatch ?? defaultMatch
  return winner ? { rate: winner.rate, rowId: winner.id } : null
}
