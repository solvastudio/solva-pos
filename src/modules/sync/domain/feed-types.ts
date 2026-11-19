export interface FeedCursor {
  version: number
  id: string
}

export interface FeedScope {
  tenantId: string
  outletId: string
  registerId: string
  deviceId: string
}

export interface FeedKey {
  entity: string
  version: number
  id: string
}

export interface FeedRow {
  entity: string
  op: 'upsert' | 'delete'
  id: string
  version: number
  row?: Record<string, unknown>
}

export interface FeedSource<TTx = unknown> {
  /** Wire entity name matching table name (e.g. 'price_entry'). */
  readonly entity: string
  /** Select keys ascending by `(version, id)`, bounded by `version <= upper`, filtered by scope, including tombstones. */
  selectKeys(
    tx: TTx,
    args: { after: FeedCursor | null; upper: number; scope: FeedScope; limit: number },
  ): Promise<FeedKey[]>
  /** Hydrate full rows; `deleted_at !== null` yields `op: 'delete'` without `row`. */
  hydrate(tx: TTx, ids: readonly string[], scope: FeedScope): Promise<FeedRow[]>
  /** Full-resync keyset pagination over live rows ordered by `id`. */
  snapshotPage(
    tx: TTx,
    args: { afterId: string | null; scope: FeedScope; limit: number },
  ): Promise<FeedRow[]>
  /** Count live rows for full-resync manifest verification. */
  count(tx: TTx, args: { upper: number; scope: FeedScope }): Promise<number>
}
