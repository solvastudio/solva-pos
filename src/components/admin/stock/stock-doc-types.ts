/** Row shapes for stock document lists (match the inventory service output, used on the client). */

export interface GrRow {
  readonly id: string
  readonly docNo: string
  readonly status: string
  readonly docType: string
  readonly outletId: string
  readonly businessDate: string
  readonly totalValue: number
}

export interface TransferRow {
  readonly id: string
  readonly docNo: string
  readonly status: string
  readonly fromOutletId: string
  readonly toOutletId: string
  readonly businessDate: string
}

export interface StocktakeRow {
  readonly id: string
  readonly docNo: string
  readonly status: string
  readonly outletId: string
  readonly scope: string
  readonly businessDate: string
  readonly postedAt: string | null
}

export interface SupplierView {
  readonly id: string
  readonly name: string
  readonly contact: string | null
  readonly active: boolean
}
