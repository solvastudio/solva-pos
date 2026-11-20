import type { CashRoundingUnit, Money, Qty } from '~/lib/kernel'

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

export interface PaymentInput {
  methodCode: string
  kind: 'CASH' | 'NON_CASH'
  /** For CASH: cash tendered by customer; for NON_CASH: exact applied amount. */
  amount: Money
  reference?: string | null
}

export interface AppliedPayment {
  methodCode: string
  kind: 'CASH' | 'NON_CASH'
  tendered: Money
  applied: Money
  change: Money
  reference: string | null
}

export interface PaymentSettlement {
  payments: AppliedPayment[]
  /** Negative or positive rounding delta applied only on settling cash payment. */
  rounding: Money
  /** Equals `grandTotal + rounding`. */
  totalDue: Money
  cashApplied: Money
  nonCashApplied: Money
  changeTotal: Money
  settled: boolean
}

export type PaymentErrorCode =
  | 'EMPTY'
  | 'NONCASH_EXCEEDS_REMAINING'
  | 'UNDERPAID'
  | 'INVALID_ORDER'
  | 'INVALID_AMOUNT'

export class PaymentError extends Error {
  constructor(
    public readonly code: PaymentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PaymentError'
  }
}

export interface ReturnLineInput {
  qtySold: Qty
  qtyAlreadyReturned: Qty
  qtyReturn: Qty
  /** `lineNet - billDiscountAlloc` stored on original `sale_line`. */
  originalNet: Money
  /** Aligned with `sale_line.service_alloc` stored on original `sale_line`. */
  originalScAlloc: Money
  originalTaxAlloc: Money
  returnedSoFar: {
    net: Money
    sc: Money
    tax: Money
  }
}

export interface ReturnLineCalc {
  net: Money
  sc: Money
  tax: Money
  isLast: boolean
}

export interface CreditNoteInput {
  lines: readonly ReturnLineInput[]
  priceTaxMode: 'INCLUSIVE' | 'EXCLUSIVE'
  refund: {
    method: 'CASH' | 'ORIGINAL'
    cashRoundingUnit: CashRoundingUnit
  }
}

export interface CreditNoteCalc {
  lines: ReturnLineCalc[]
  netTotal: Money
  scTotal: Money
  taxTotal: Money
  refundGross: Money
  refundCashApplied: Money | null
  rounding: Money
}

export type ReturnErrorCode = 'EMPTY' | 'EXCEEDS_QTY' | 'INVALID_QTY' | 'INVALID_AMOUNT'

export class ReturnError extends Error {
  constructor(
    public readonly code: ReturnErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ReturnError'
  }
}

export interface ExpectedCashInput {
  openingFloat: Money
  cashSalesApplied: readonly Money[]
  cashIn: readonly Money[]
  cashOut: readonly Money[]
  cashRefunds: readonly Money[]
}

export interface StoredSaleFigures {
  lines: readonly LineCalc[]
  grossTotal: Money
  lineDiscountTotal: Money
  billDiscountTotal: Money
  netSubtotal: Money
  serviceCharge: Money
  taxBase: Money
  taxAmount: Money
  dpp: Money
  grandTotal: Money
  rounding: Money
  totalDue: Money
}

export interface StoredCreditNoteFigures {
  lines: readonly ReturnLineCalc[]
  netTotal: Money
  scTotal: Money
  taxTotal: Money
  refundGross: Money
  refundCashApplied: Money | null
  rounding: Money
}

export interface FigureDiff {
  path: string
  expected: number
  actual: number
}

export interface VerifyResult {
  ok: boolean
  diffs: FigureDiff[]
}
