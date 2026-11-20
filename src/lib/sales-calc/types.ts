import type { Money, Qty } from '~/lib/kernel'

export type SalesCalcErrorCode =
  | 'EMPTY_CART'
  | 'INVALID_DISCOUNT'
  | 'INVALID_CONFIG'
  | 'INVALID_LINE'
  | 'INVARIANT'

export class SalesCalcError extends Error {
  constructor(
    public readonly code: SalesCalcErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SalesCalcError'
  }
}

export type DiscountInput =
  | { kind: 'PERCENT'; percent: string }
  | { kind: 'NOMINAL'; amount: Money }

export interface CartLineInput {
  lineNo: number
  skuId: string
  uomId: string
  qty: Qty
  unitPrice: Money
  taxable: boolean
  isOpenPrice?: boolean
  discount?: DiscountInput
}

export interface SaleConfigSnapshot {
  priceTaxMode: 'INCLUSIVE' | 'EXCLUSIVE'
  taxProfile: 'NONE' | 'PPN' | 'PB1'
  taxRate: string
  serviceChargeEnabled: boolean
  serviceChargeRate: string
  serviceChargeTaxable: boolean
}

export interface SaleCalcInput {
  lines: readonly CartLineInput[]
  billDiscount?: DiscountInput
  config: SaleConfigSnapshot
}

export interface LineCalc {
  lineNo: number
  lineGross: Money
  lineDiscount: Money
  lineNet: Money
  billDiscountAlloc: Money
  /** Aligned with `sale_line.service_alloc` in `docs/SCHEMA.md` §4.5.4 (draft `scAlloc`). */
  serviceAlloc: Money
  taxAlloc: Money
  lineTotal: Money
}

export interface SaleCalc {
  lines: LineCalc[]
  grossTotal: Money
  lineDiscountTotal: Money
  billDiscountTotal: Money
  netSubtotal: Money
  serviceCharge: Money
  taxBase: Money
  taxAmount: Money
  dpp: Money
  grandTotal: Money
}

export interface TaxRateRow {
  id: string
  taxCode: 'PPN' | 'PB1'
  outletId: string | null
  rate: string
  effectiveFrom: string
  deleted?: boolean
}
