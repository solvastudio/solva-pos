export { AUDIT_ACTIONS, isAuditAction, type AuditAction } from './domain/actions'
export type { CanonicalAuditFields } from './domain/canonical'

export type AuditJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly AuditJsonValue[]
  | { readonly [key: string]: AuditJsonValue }

export interface AuditLogView {
  readonly id: string
  readonly chainSeq: number
  readonly outletId: string | null
  readonly outletName: string | null
  readonly outletTimezone: string | null
  readonly registerId: string | null
  readonly deviceId: string | null
  readonly actorUserId: string | null
  readonly actorName: string | null
  readonly approverUserId: string | null
  readonly approverName: string | null
  readonly action: string
  readonly entityType: string
  readonly entityId: string | null
  readonly beforeData: AuditJsonValue
  readonly afterData: AuditJsonValue
  readonly reasonCode: string | null
  readonly reasonText: string | null
  readonly occurredAt: string
  readonly recordedAt: string
  readonly businessDate: string | null
}

export interface AuditQueryFilter {
  readonly actorUserId?: string | null
  readonly action?: string | null
  readonly outletId?: string | null
  readonly fromDate?: string | null
  readonly toDate?: string | null
  readonly sort?: 'asc' | 'desc'
  readonly limit?: number
  readonly offset?: number
}

export type VerifyChainStatus =
  | { readonly ok: true; readonly checked: number }
  | {
      readonly ok: false
      readonly brokenAtSeq: number
      readonly reason: 'PREV_HASH' | 'ROW_HASH' | 'SEQ_GAP'
    }
