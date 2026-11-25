import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { MODIFIER_ADJUST_TYPE, MODIFIER_SELECTION_TYPE } from '~/lib/contracts'
import { moneyBigint, qtyNumeric, uuidId } from '~/server/db/columns'
import { product, sku } from './schema'
import { stdMColumns, stdSColumns } from './std-columns'

function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ')
}

/**
 * F&B modifier groups (Class M, full tenant feed). SCHEMA §4.2.9.
 */
export const modifierGroup = pgTable(
  'modifier_group',
  {
    ...stdMColumns(),
    name: text('name').notNull(),
    selectionType: text('selection_type').notNull().default('MULTI'),
    minSelect: integer('min_select').notNull().default(0),
    maxSelect: integer('max_select'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    unique('uq_modifier_group__tenant_id_id').on(t.tenantId, t.id),
    index('ix_modifier_group__feed').on(t.tenantId, t.version, t.id),
    check('ck_modifier_group__version', sql`${t.version} > 0`),
    check('ck_modifier_group__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    check(
      'ck_modifier_group__selection_type',
      sql.raw(`selection_type IN (${sqlInList(MODIFIER_SELECTION_TYPE)})`),
    ),
    check('ck_modifier_group__min_select', sql`${t.minSelect} >= 0`),
    check(
      'ck_modifier_group__max_select',
      sql`${t.maxSelect} IS NULL OR ${t.maxSelect} >= ${t.minSelect}`,
    ),
  ],
)

/**
 * Links F&B menu products to modifier groups (Class M, full tenant feed). SCHEMA §4.2.9.
 */
export const modifierGroupProduct = pgTable(
  'modifier_group_product',
  {
    ...stdMColumns(),
    modifierGroupId: uuidId('modifier_group_id').notNull(),
    productId: uuidId('product_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('uq_modifier_group_product__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_modifier_group_product__pair').on(t.modifierGroupId, t.productId),
    index('ix_modifier_group_product__feed').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId, t.modifierGroupId],
      foreignColumns: [modifierGroup.tenantId, modifierGroup.id],
      name: 'fk_mod_grp_prod__group',
    }),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [product.tenantId, product.id],
      name: 'fk_mod_grp_prod__product',
    }),
    check('ck_modifier_group_product__version', sql`${t.version} > 0`),
  ],
)

/**
 * Individual modifier options within a group (Class M, full tenant feed). SCHEMA §4.2.9.
 */
export const modifier = pgTable(
  'modifier',
  {
    ...stdMColumns(),
    modifierGroupId: uuidId('modifier_group_id').notNull(),
    name: text('name').notNull(),
    priceDelta: moneyBigint('price_delta').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('uq_modifier__tenant_id_id').on(t.tenantId, t.id),
    uniqueIndex('uq_modifier__group_name')
      .on(t.modifierGroupId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    index('ix_modifier__feed').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId, t.modifierGroupId],
      foreignColumns: [modifierGroup.tenantId, modifierGroup.id],
      name: 'fk_modifier__group',
    }),
    check('ck_modifier__version', sql`${t.version} > 0`),
    check('ck_modifier__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 60`),
  ],
)

/**
 * Server-only modifier ingredient adjustments for recipe consumption (Class S). SCHEMA §4.2.10.
 */
export const modifierIngredient = pgTable(
  'modifier_ingredient',
  {
    ...stdSColumns(),
    modifierId: uuidId('modifier_id').notNull(),
    ingredientSkuId: uuidId('ingredient_sku_id').notNull(),
    adjustType: text('adjust_type').notNull(),
    qty: qtyNumeric('qty'),
  },
  (t) => [
    unique('uq_modifier_ingredient__tenant_id_id').on(t.tenantId, t.id),
    uniqueIndex('uq_modifier_ingredient__mod_sku')
      .on(t.modifierId, t.ingredientSkuId)
      .where(sql`${t.deletedAt} IS NULL`),
    foreignKey({
      columns: [t.tenantId, t.modifierId],
      foreignColumns: [modifier.tenantId, modifier.id],
      name: 'fk_modifier_ingredient__modifier',
    }),
    foreignKey({
      columns: [t.tenantId, t.ingredientSkuId],
      foreignColumns: [sku.tenantId, sku.id],
      name: 'fk_modifier_ingredient__ingredient_sku',
    }),
    check(
      'ck_modifier_ingredient__adjust_type',
      sql.raw(`adjust_type IN (${sqlInList(MODIFIER_ADJUST_TYPE)})`),
    ),
    check(
      'ck_modifier_ingredient__adjust_qty',
      sql`(${t.adjustType} = 'REMOVE' AND ${t.qty} IS NULL) OR (${t.adjustType} IN ('ADD', 'REDUCE') AND ${t.qty} IS NOT NULL AND ${t.qty} > 0)`,
    ),
  ],
)

/**
 * Server-only single-level recipe / BOM rows per menu SKU (Class S). SCHEMA §4.2.11.
 */
export const recipeItem = pgTable(
  'recipe_item',
  {
    ...stdSColumns(),
    menuSkuId: uuidId('menu_sku_id').notNull(),
    ingredientSkuId: uuidId('ingredient_sku_id').notNull(),
    qty: qtyNumeric('qty').notNull(),
  },
  (t) => [
    unique('uq_recipe_item__tenant_id_id').on(t.tenantId, t.id),
    uniqueIndex('uq_recipe_item__menu_ingredient')
      .on(t.menuSkuId, t.ingredientSkuId)
      .where(sql`${t.deletedAt} IS NULL`),
    foreignKey({
      columns: [t.tenantId, t.menuSkuId],
      foreignColumns: [sku.tenantId, sku.id],
      name: 'fk_recipe_item__menu_sku',
    }),
    foreignKey({
      columns: [t.tenantId, t.ingredientSkuId],
      foreignColumns: [sku.tenantId, sku.id],
      name: 'fk_recipe_item__ingredient_sku',
    }),
    check('ck_recipe_item__qty_pos', sql`${t.qty} > 0`),
    check('ck_recipe_item__distinct_skus', sql`${t.menuSkuId} <> ${t.ingredientSkuId}`),
  ],
)
