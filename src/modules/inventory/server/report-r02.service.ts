import '@tanstack/react-start/server-only'
import { normalizeQty, parseQty, toMoney } from '~/lib/kernel'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { withTenant } from '~/server/db'
import { averageCostForDisplay } from '../domain/costing'
import { scopeOf } from './outlet-scope'
import { queryValuation } from './valuation.repo'

/**
 * R-02 report — Stock & Inventory Value (FR-RPT-003, PRD §12 R-02).
 * - Outlet balance from `stock_balance` (authoritative source); in-transit is shown separately (`v_in_transit`, SENT only).
 * - Average cost = value ÷ qty, for display only (BR-HPP-002); not stored.
 * - Unavailable items stay visible and their value still counts toward the outlet total (BR-CAT-017).
 */

export type AvailabilityFilter = 'ALL' | 'AVAILABLE' | 'UNAVAILABLE'

export interface R02Filter {
  readonly outletId?: string
  readonly categoryId?: string
  readonly onlyNegative?: boolean
  readonly onlyInTransit?: boolean
  readonly availability?: AvailabilityFilter
}

export interface R02Row {
  readonly outletId: string
  readonly outletCode: string
  readonly outletName: string
  readonly skuId: string
  readonly skuCode: string
  readonly productName: string
  /** Quantity in base UOM, canonical string. */
  readonly qty: string
  /** Display average cost (2 decimals), or `null` when qty ≤ 0. */
  readonly avgCost: string | null
  readonly inventoryValue: number
  readonly isNegative: boolean
  readonly qtyInTransit: string
  readonly valueInTransit: number
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE'
}

export interface R02OutletTotal {
  readonly outletId: string
  readonly outletCode: string
  readonly outletName: string
  readonly inventoryValue: number
  readonly negativeCount: number
  readonly valueInTransit: number
}

export interface R02Result {
  readonly rows: readonly R02Row[]
  readonly totals: readonly R02OutletTotal[]
}

export async function reportR02(actor: IdentityAuthActor, filter: R02Filter = {}): Promise<R02Result> {
  requireActorPermission(actor, 'report.view', filter.outletId ? { outletId: filter.outletId } : undefined)
  const raw = await withTenant(actor.tenantId, (tx) =>
    queryValuation(tx, actor.tenantId, {
      // Scope-limited actors only see their own outlets, also when no outlet filter is given.
      outletIds: scopeOf(actor),
      outletId: filter.outletId,
      categoryId: filter.categoryId,
      onlyNegative: filter.onlyNegative,
      onlyInTransit: filter.onlyInTransit,
    }),
  )

  const availability = filter.availability ?? 'ALL'
  const rows: R02Row[] = raw
    .filter((r) => availability === 'ALL' || r.availability === availability)
    .map((r) => {
      const qty = parseQty(r.qty)
      const avgCost = averageCostForDisplay({
        qty,
        inventoryValue: toMoney(r.inventoryValue),
        refValue: toMoney(0),
        refQty: parseQty('0'),
        rev: 0,
      })
      return {
        outletId: r.outletId,
        outletCode: r.outletCode,
        outletName: r.outletName,
        skuId: r.skuId,
        skuCode: r.skuCode,
        productName: r.productName,
        qty: normalizeQty(qty),
        avgCost,
        inventoryValue: r.inventoryValue,
        isNegative: r.isNegative,
        qtyInTransit: normalizeQty(parseQty(r.qtyInTransit)),
        valueInTransit: r.valueInTransit,
        availability: r.availability === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE',
      }
    })

  const byOutlet = new Map<string, R02OutletTotal>()
  for (const r of rows) {
    const cur = byOutlet.get(r.outletId) ?? {
      outletId: r.outletId,
      outletCode: r.outletCode,
      outletName: r.outletName,
      inventoryValue: 0,
      negativeCount: 0,
      valueInTransit: 0,
    }
    byOutlet.set(r.outletId, {
      ...cur,
      inventoryValue: cur.inventoryValue + r.inventoryValue,
      negativeCount: cur.negativeCount + (r.isNegative ? 1 : 0),
      valueInTransit: cur.valueInTransit + r.valueInTransit,
    })
  }
  return {
    rows,
    totals: [...byOutlet.values()].sort((a, b) =>
      (a.outletName || a.outletCode).localeCompare(b.outletName || b.outletCode),
    ),
  }
}
