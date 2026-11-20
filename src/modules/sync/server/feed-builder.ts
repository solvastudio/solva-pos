import '@tanstack/react-start/server-only'
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { AnyPgColumn, PgTable, SelectedFields } from 'drizzle-orm/pg-core'
import { parseSafeBigint, type TenantTx } from '~/server/db'
import type { FeedKey, FeedRow, FeedScope, FeedSource } from '../domain/feed-types'
import { kWayMerge } from '../domain/merge'

export interface FeedTableColumns {
  id: AnyPgColumn
  version: AnyPgColumn
  tenantId: AnyPgColumn
  deletedAt?: AnyPgColumn | null
}

export interface FeedTableSpec<T extends PgTable> {
  entity: string
  table: T
  columns: FeedTableColumns
  /**
   * Coarse scope filter applied during incremental `selectKeys`:
   * - Small tables whose scope can move rows OUT of scope (e.g. `app_user`, `user_outlet`,
   *   `register_invoice_prefix`) keep `selectKeys` scoped by tenant only so scope departures still
   *   enter `hydrate` and emit `op: 'delete'` via `inScope`.
   * - Large tables (e.g. outlet-scoped entities or catalog in Fase 33) filter outlet in `selectKeys`.
   */
  selectScopeWhere?: (scope: FeedScope) => SQL | undefined
  /**
   * Optional disjoint index branches for `selectKeys` when an `OR` scope predicate (such as
   * `outlet_id = scope.outletId OR outlet_id IS NULL`) cannot avoid a sort in PostgreSQL.
   * Each branch queries its own composite index bounded by `(version, id) LIMIT N`, and results
   * are merged via `kWayMerge`.
   */
  selectScopeBranches?: (scope: FeedScope) => SQL[]
  /**
   * When `true` (large/outlet-partitioned catalog tables), `selectScopeWhere` is applied directly
   * inside `selectKeys` so only the index-covered tenant/outlet slice enters k-way merge.
   * When `false`, `selectKeys` scans the tenant feed index and defers scope filtering to `inScope`.
   */
  scopeInSelectKeys?: boolean
  /** Exact scope predicate used in `snapshotPage` and `count`. Falls back to `selectScopeWhere`. */
  snapshotScopeWhere?: (scope: FeedScope) => SQL | undefined
  /** Additional SQL condition for live-only snapshot/count queries (e.g. active membership). */
  liveOnlyWhere?: (scope: FeedScope) => SQL | undefined
  /** Enables physical `DELETE` cleanup of tombstoned rows at or below `tombstone_floor_version`. */
  purgeBelowFloor?: boolean
  /**
   * Optional scope predicate evaluated during `hydrate`. When false for a non-deleted row,
   * `hydrate` emits `{ op: 'delete', id, version }` for this device.
   */
  inScope?: (
    row: Record<string, unknown>,
    scope: FeedScope,
    tx: TenantTx,
  ) => boolean | Promise<boolean>
  /** Projects a snake_case DB row down to wire fields (`created_by`/`updated_by` are always stripped). */
  project?: (row: Record<string, unknown>) => Record<string, unknown>
}

export function omitWireColumns(
  row: Record<string, unknown>,
  excludedKeys: readonly string[],
): Record<string, unknown> {
  if (excludedKeys.length === 0) return { ...row }
  const blocked = new Set(excludedKeys)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (!blocked.has(k)) {
      out[k] = v
    }
  }
  return out
}

function normalizeWireValue(colName: string, value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (colName === 'id' && typeof value === 'string') {
    return value.toLowerCase()
  }
  if (colName === 'version' && value !== null && value !== undefined) {
    return typeof value === 'number' ? value : parseSafeBigint(value)
  }
  return value
}

function toSnakeWireRow(
  tableCols: Record<string, AnyPgColumn>,
  drizzleRow: Record<string, unknown>,
): Record<string, unknown> {
  const wire: Record<string, unknown> = {}
  for (const [tsKey, col] of Object.entries(tableCols)) {
    wire[col.name] = normalizeWireValue(col.name, drizzleRow[tsKey])
  }
  return wire
}

function buildSelectCols(tableCols: Record<string, AnyPgColumn>): SelectedFields {
  const cols: Record<string, AnyPgColumn> = {}
  for (const [tsKey, col] of Object.entries(tableCols)) {
    cols[tsKey] = col
  }
  return cols
}

export function buildFeedSource<T extends PgTable>(spec: FeedTableSpec<T>): FeedSource<TenantTx> {
  const tableCols = getTableColumns(spec.table) as Record<string, AnyPgColumn>
  const selectCols = buildSelectCols(tableCols)
  const { columns } = spec

  const baseLiveConditions = (scope: FeedScope): SQL[] => {
    const conds: SQL[] = [eq(columns.tenantId, scope.tenantId)]
    if (columns.deletedAt) {
      conds.push(isNull(columns.deletedAt))
    }
    const scopeSql = (spec.snapshotScopeWhere ?? spec.selectScopeWhere)?.(scope)
    if (scopeSql) {
      conds.push(scopeSql)
    }
    const liveSql = spec.liveOnlyWhere?.(scope)
    if (liveSql) {
      conds.push(liveSql)
    }
    return conds
  }

  const projectWireRow = (snakeRow: Record<string, unknown>): Record<string, unknown> => {
    const base = omitWireColumns(snakeRow, ['created_by', 'updated_by'])
    return spec.project ? spec.project(base) : base
  }

  return {
    entity: spec.entity,

    async selectKeys(tx, { after, upper, scope, limit }): Promise<FeedKey[]> {
      const baseConds: SQL[] = [eq(columns.tenantId, scope.tenantId), lte(columns.version, upper)]
      if (after !== null) {
        baseConds.push(
          sql`(${columns.version}, ${columns.id}) > (${after.version}, ${after.id}::uuid)`,
        )
      }

      const toKeys = (
        rows: Array<{ id: unknown; version: unknown }>,
      ): FeedKey[] =>
        rows.map((r) => ({
          entity: spec.entity,
          id: String(r.id).toLowerCase(),
          version: typeof r.version === 'number' ? r.version : parseSafeBigint(r.version),
        }))

      if (spec.scopeInSelectKeys !== false && spec.selectScopeBranches) {
        const branches = spec.selectScopeBranches(scope)
        const branchLists: FeedKey[][] = []
        for (const branchSql of branches) {
          const rows = await tx
            .select({ id: columns.id, version: columns.version })
            .from(spec.table as PgTable)
            .where(and(...baseConds, branchSql))
            .orderBy(asc(columns.version), asc(columns.id))
            .limit(limit)
          branchLists.push(toKeys(rows))
        }
        return kWayMerge(branchLists, limit)
      }

      const conds: SQL[] = [...baseConds]
      const scopeSql =
        spec.scopeInSelectKeys === false ? undefined : spec.selectScopeWhere?.(scope)
      if (scopeSql) {
        conds.push(scopeSql)
      }

      const rows = await tx
        .select({
          id: columns.id,
          version: columns.version,
        })
        .from(spec.table as PgTable)
        .where(and(...conds))
        .orderBy(asc(columns.version), asc(columns.id))
        .limit(limit)

      return toKeys(rows)
    },

    async hydrate(tx, ids, scope): Promise<FeedRow[]> {
      if (ids.length === 0) return []

      const rawRows = await tx
        .select(selectCols)
        .from(spec.table as PgTable)
        .where(and(eq(columns.tenantId, scope.tenantId), inArray(columns.id, [...ids])))

      const out: FeedRow[] = []
      const deletedColName = columns.deletedAt?.name ?? null
      const idColName = columns.id.name
      const versionColName = columns.version.name

      for (const raw of rawRows) {
        const snakeRow = toSnakeWireRow(tableCols, raw as Record<string, unknown>)
        const id = String(snakeRow[idColName]).toLowerCase()
        const version = Number(snakeRow[versionColName])

        const isDeleted =
          deletedColName !== null &&
          snakeRow[deletedColName] !== null &&
          snakeRow[deletedColName] !== undefined
        if (isDeleted) {
          out.push({ entity: spec.entity, op: 'delete', id, version })
          continue
        }

        if (spec.inScope && !(await spec.inScope(snakeRow, scope, tx))) {
          out.push({ entity: spec.entity, op: 'delete', id, version })
          continue
        }

        out.push({
          entity: spec.entity,
          op: 'upsert',
          id,
          version,
          row: projectWireRow(snakeRow),
        })
      }

      return out
    },

    async snapshotPage(tx, { afterId, scope, limit }): Promise<FeedRow[]> {
      const conds = baseLiveConditions(scope)
      if (afterId !== null) {
        conds.push(gt(columns.id, afterId))
      }

      const rawRows = await tx
        .select(selectCols)
        .from(spec.table as PgTable)
        .where(and(...conds))
        .orderBy(asc(columns.id))
        .limit(limit)

      const idColName = columns.id.name
      const versionColName = columns.version.name
      return rawRows.map((raw) => {
        const snakeRow = toSnakeWireRow(tableCols, raw as Record<string, unknown>)
        return {
          entity: spec.entity,
          op: 'upsert',
          id: String(snakeRow[idColName]).toLowerCase(),
          version: Number(snakeRow[versionColName]),
          row: projectWireRow(snakeRow),
        }
      })
    },

    async count(tx, { upper, scope }): Promise<number> {
      const conds = [...baseLiveConditions(scope), lte(columns.version, upper)]
      const rows = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(spec.table as PgTable)
        .where(and(...conds))
      return Number(rows[0]?.total ?? 0)
    },

    async maxTombstoneVersionOlderThan(tx, { cutoffIso }): Promise<number | null> {
      if (!columns.deletedAt) {
        return null
      }
      const rows = await tx
        .select({ maxVer: sql<unknown>`max(${columns.version})` })
        .from(spec.table as PgTable)
        .where(and(isNotNull(columns.deletedAt), lt(columns.deletedAt, cutoffIso)))
      const maxVer = rows[0]?.maxVer
      if (maxVer === null || maxVer === undefined) {
        return null
      }
      return parseSafeBigint(maxVer)
    },

    async purgeBelowFloor(tx, { floorVersion }): Promise<number> {
      if (!spec.purgeBelowFloor || !columns.deletedAt) {
        return 0
      }
      const deleted = await tx
        .delete(spec.table as PgTable)
        .where(and(isNotNull(columns.deletedAt), lte(columns.version, floorVersion)))
        .returning({ id: columns.id })
      return deleted.length
    },
  }
}
