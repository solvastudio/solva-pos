import '@tanstack/react-start/server-only'
import { buildFeedSource, omitWireColumns, type FeedSource } from '~/modules/sync/public'
import { modifier, modifierGroup, modifierGroupProduct } from './schema-fnb'

const CATALOG_FNB_INTERNAL_WIRE_KEYS = [
  'tenant_id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'deleted_at',
] as const

/**
 * Class M sync feed sources for F&B modifiers in FK dependency order.
 */
export function catalogFnbFeedSources(): FeedSource[] {
  return [
    buildFeedSource({
      entity: 'modifier_group',
      table: modifierGroup,
      columns: {
        id: modifierGroup.id,
        tenantId: modifierGroup.tenantId,
        version: modifierGroup.version,
        deletedAt: modifierGroup.deletedAt,
      },
      project: (row) => omitWireColumns(row, CATALOG_FNB_INTERNAL_WIRE_KEYS),
    }),
    buildFeedSource({
      entity: 'modifier',
      table: modifier,
      columns: {
        id: modifier.id,
        tenantId: modifier.tenantId,
        version: modifier.version,
        deletedAt: modifier.deletedAt,
      },
      project: (row) => omitWireColumns(row, CATALOG_FNB_INTERNAL_WIRE_KEYS),
    }),
    buildFeedSource({
      entity: 'modifier_group_product',
      table: modifierGroupProduct,
      columns: {
        id: modifierGroupProduct.id,
        tenantId: modifierGroupProduct.tenantId,
        version: modifierGroupProduct.version,
        deletedAt: modifierGroupProduct.deletedAt,
      },
      project: (row) => omitWireColumns(row, CATALOG_FNB_INTERNAL_WIRE_KEYS),
    }),
  ]
}
