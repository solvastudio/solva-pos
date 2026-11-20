/** Ordered entity names streamed during a full-resync cycle (parent tables before children). */
export const FULL_RESYNC_ENTITY_ORDER = [
  'tenant',
  'legal_entity',
  'outlet',
  'outlet_receipt_setting',
  'cash_master',
  'register_invoice_prefix',
  'tax_rate_history',
  'payment_method',
  'feature_flag',
  'role',
  'role_permission',
  'app_user',
  'user_outlet',
  'staff_pin',
  'category',
  'uom',
  'product',
  'sku',
  'sku_uom',
  'item_outlet_availability',
  'price_entry',
] as const

export type FullResyncEntity = (typeof FULL_RESYNC_ENTITY_ORDER)[number]

export interface AttentionPayloadSummary {
  readonly invoiceNo?: string | null
  readonly cnNo?: string | null
  readonly totalDue?: number | null
  readonly lineCount?: number | null
  readonly shiftId?: string | null
  readonly direction?: string | null
}

export type SyncJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly SyncJsonValue[]
  | { readonly [key: string]: SyncJsonValue }

export interface AttentionItemView {
  readonly id: string
  readonly outletId: string
  readonly registerId: string
  readonly registerCode: string | null
  readonly deviceId: string
  readonly commandId: string
  readonly commandType: string
  readonly reasonClass: 'STRUCTURAL' | 'AUTHORIZATION'
  readonly reasonCode: string
  readonly detail: string | null
  readonly blockedByCommandId: string | null
  readonly status: 'OPEN' | 'ACCEPTED' | 'DISMISSED' | 'ESCALATED'
  readonly canAcceptManual: boolean
  readonly resolutionNote: string | null
  readonly resolvedBy: string | null
  readonly resolvedAt: string | null
  readonly requestRef: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly summary: AttentionPayloadSummary
  readonly rawPayload: SyncJsonValue
}

export interface PendingImportErrorItem {
  readonly commandId: string
  readonly deviceSeq: number
  readonly code: string
  readonly message: string
}

export interface PendingImportResult {
  readonly deviceId: string
  readonly registerId: string
  readonly total: number
  readonly acked: number
  readonly replayed: number
  readonly attention: number
  readonly held: number
  readonly skipped: number
  readonly errors: readonly PendingImportErrorItem[]
}
