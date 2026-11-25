import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import { buildFeedSource, omitWireColumns, type FeedSource } from '~/modules/sync/public'
import { fnbTable } from './schema'

const FNB_INTERNAL_WIRE_KEYS = [
  'tenant_id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'deleted_at',
] as const

/**
 * Constructs the `FeedSource` adapter for outlet-scoped `fnb_table` master records.
 */
export function fnbFeedSources(): FeedSource[] {
  return [
    buildFeedSource({
      entity: 'fnb_table',
      table: fnbTable,
      columns: {
        id: fnbTable.id,
        tenantId: fnbTable.tenantId,
        version: fnbTable.version,
        deletedAt: fnbTable.deletedAt,
      },
      scopeInSelectKeys: true,
      selectScopeWhere: (scope) => eq(fnbTable.outletId, scope.outletId),
      inScope: (row, scope) => row.outlet_id === scope.outletId,
      project: (row) => omitWireColumns(row, FNB_INTERNAL_WIRE_KEYS),
    }),
  ]
}
