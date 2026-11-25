export * from './shared/bill-events'
export * from './shared/bill-projection'

export interface FnbTableView {
  readonly id: string
  readonly outletId: string
  readonly code: string
  readonly area: string | null
  readonly capacity: number | null
  readonly sortOrder: number
  readonly isActive: boolean
  readonly hasAnyBill: boolean
  readonly hasOpenBill: boolean
}
