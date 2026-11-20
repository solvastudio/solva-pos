import '@tanstack/react-start/server-only'
import { eq, isNull, or } from 'drizzle-orm'
import { buildFeedSource, omitWireColumns, type FeedSource } from '~/modules/sync/public'
import {
  category,
  itemOutletAvailability,
  priceEntry,
  product,
  sku,
  skuUom,
  uom,
} from './schema'

const CATALOG_INTERNAL_WIRE_KEYS = ['tenant_id', 'created_at', 'updated_at', 'deleted_at'] as const

/**
 * Constructs `FeedSource` adapters for the 7 client-visible Catalog entities in sync order
 * (`product_attribute`, `attribute_value`, `sku_attribute_value` are intentionally server-only).
 *
 * `item_outlet_availability` and `price_entry` set `scopeInSelectKeys: true` so outlet scoping runs
 * directly inside `selectKeys` using `(tenant_id, outlet_id, version, id)` and partial default indexes.
 */
export function catalogFeedSources(): FeedSource[] {
  return [
    buildFeedSource({
      entity: 'category',
      table: category,
      columns: {
        id: category.id,
        tenantId: category.tenantId,
        version: category.version,
        deletedAt: category.deletedAt,
      },
      project: (row) => omitWireColumns(row, CATALOG_INTERNAL_WIRE_KEYS),
    }),

    buildFeedSource({
      entity: 'uom',
      table: uom,
      columns: {
        id: uom.id,
        tenantId: uom.tenantId,
        version: uom.version,
        deletedAt: uom.deletedAt,
      },
      project: (row) => omitWireColumns(row, CATALOG_INTERNAL_WIRE_KEYS),
    }),

    buildFeedSource({
      entity: 'product',
      table: product,
      columns: {
        id: product.id,
        tenantId: product.tenantId,
        version: product.version,
        deletedAt: product.deletedAt,
      },
      project: (row) => omitWireColumns(row, CATALOG_INTERNAL_WIRE_KEYS),
    }),

    buildFeedSource({
      entity: 'sku',
      table: sku,
      columns: {
        id: sku.id,
        tenantId: sku.tenantId,
        version: sku.version,
        deletedAt: sku.deletedAt,
      },
      project: (row) => omitWireColumns(row, CATALOG_INTERNAL_WIRE_KEYS),
    }),

    buildFeedSource({
      entity: 'sku_uom',
      table: skuUom,
      columns: {
        id: skuUom.id,
        tenantId: skuUom.tenantId,
        version: skuUom.version,
        deletedAt: skuUom.deletedAt,
      },
      project: (row) => omitWireColumns(row, CATALOG_INTERNAL_WIRE_KEYS),
    }),

    buildFeedSource({
      entity: 'item_outlet_availability',
      table: itemOutletAvailability,
      columns: {
        id: itemOutletAvailability.id,
        tenantId: itemOutletAvailability.tenantId,
        version: itemOutletAvailability.version,
        deletedAt: itemOutletAvailability.deletedAt,
      },
      scopeInSelectKeys: true,
      selectScopeWhere: (scope) => eq(itemOutletAvailability.outletId, scope.outletId),
      inScope: (row, scope) => row.outlet_id === scope.outletId,
      purgeBelowFloor: true,
      project: (row) => omitWireColumns(row, [...CATALOG_INTERNAL_WIRE_KEYS, 'changed_by']),
    }),

    // Splitting into outlet-specific and NULL-default branches avoids OR+Sort/Seq Scan in PostgreSQL
    // so both `ix_price_entry__feed_outlet` (0.18ms Index Scan) and `ix_price_entry__feed_default`
    // (0.16ms Index Scan) execute without Seq Scan (5,000-SKU pull benchmark: p50=39.1ms, p95=65.9ms).
    buildFeedSource({
      entity: 'price_entry',
      table: priceEntry,
      columns: {
        id: priceEntry.id,
        tenantId: priceEntry.tenantId,
        version: priceEntry.version,
        deletedAt: priceEntry.deletedAt,
      },
      scopeInSelectKeys: true,
      selectScopeBranches: (scope) => [
        eq(priceEntry.outletId, scope.outletId),
        isNull(priceEntry.outletId),
      ],
      snapshotScopeWhere: (scope) =>
        or(eq(priceEntry.outletId, scope.outletId), isNull(priceEntry.outletId)),
      inScope: (row, scope) => row.outlet_id === null || row.outlet_id === scope.outletId,
      purgeBelowFloor: true,
      project: (row) => omitWireColumns(row, CATALOG_INTERNAL_WIRE_KEYS),
    }),
  ]
}
