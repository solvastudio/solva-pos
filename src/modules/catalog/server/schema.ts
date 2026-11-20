import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { isoTimestamptz, moneyBigint, qtyNumeric, uuidId } from '~/server/db/columns'
import { stdMColumns, stdSColumns } from './std-columns'

export const category = pgTable(
  'category',
  {
    ...stdMColumns(),
    parentId: uuidId('parent_id'),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('uq_category__tenant_id_id').on(t.tenantId, t.id),
    index('ix_category__feed').on(t.tenantId, t.version, t.id),
    check('ck_category__version', sql`${t.version} > 0`),
    check('ck_category__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check('ck_category__not_self_parent', sql`${t.parentId} IS DISTINCT FROM ${t.id}`),
  ],
)

export const uom = pgTable(
  'uom',
  {
    ...stdMColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    allowFraction: boolean('allow_fraction').notNull().default(false),
  },
  (t) => [
    unique('uq_uom__tenant_id_id').on(t.tenantId, t.id),
    index('ix_uom__feed').on(t.tenantId, t.version, t.id),
    check('ck_uom__version', sql`${t.version} > 0`),
    check('ck_uom__code', sql`${t.code} ~ '^[a-z0-9]{1,12}$'`),
  ],
)

export const product = pgTable(
  'product',
  {
    ...stdMColumns(),
    categoryId: uuidId('category_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    productType: text('product_type').notNull().default('RETAIL'),
    hasVariants: boolean('has_variants').notNull().default(false),
    baseUomId: uuidId('base_uom_id').notNull(),
    trackStock: boolean('track_stock').notNull().default(true),
    taxable: boolean('taxable').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    isOpenPrice: boolean('is_open_price').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('uq_product__tenant_id_id').on(t.tenantId, t.id),
    index('ix_product__feed').on(t.tenantId, t.version, t.id),
    uniqueIndex('uq_product__tenant_code')
      .on(t.tenantId, t.code)
      .where(sql`${t.deletedAt} IS NULL`),
    foreignKey({
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [category.tenantId, category.id],
      name: 'fk_product__category',
    }),
    foreignKey({
      columns: [t.tenantId, t.baseUomId],
      foreignColumns: [uom.tenantId, uom.id],
      name: 'fk_product__base_uom',
    }),
    check('ck_product__version', sql`${t.version} > 0`),
    check('ck_product__code', sql`${t.code} ~ '^[A-Za-z0-9\\-_.]{1,30}$'`),
    check('ck_product__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 160`),
    check('ck_product__type', sql`${t.productType} IN ('RETAIL', 'MENU_FNB')`),
  ],
)

export const productAttribute = pgTable(
  'product_attribute',
  {
    ...stdSColumns(),
    productId: uuidId('product_id').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('uq_product_attribute__tenant_id_id').on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [product.tenantId, product.id],
      name: 'fk_product_attribute__product',
    }),
    check('ck_product_attribute__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 40`),
  ],
)

export const attributeValue = pgTable(
  'attribute_value',
  {
    ...stdSColumns(),
    attributeId: uuidId('attribute_id').notNull(),
    value: text('value').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('uq_attribute_value__tenant_id_id').on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.attributeId],
      foreignColumns: [productAttribute.tenantId, productAttribute.id],
      name: 'fk_attribute_value__attribute',
    }),
    check('ck_attribute_value__value_len', sql`char_length(${t.value}) BETWEEN 1 AND 40`),
  ],
)

export const sku = pgTable(
  'sku',
  {
    ...stdMColumns(),
    productId: uuidId('product_id').notNull(),
    skuCode: text('sku_code').notNull(),
    variantLabel: text('variant_label'),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('uq_sku__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_sku__id_product').on(t.id, t.productId),
    index('ix_sku__feed').on(t.tenantId, t.version, t.id),
    index('ix_sku__product').on(t.tenantId, t.productId),
    uniqueIndex('uq_sku__tenant_code')
      .on(t.tenantId, t.skuCode)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('uq_sku__product_default')
      .on(t.productId)
      .where(sql`${t.isDefault} AND ${t.deletedAt} IS NULL`),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [product.tenantId, product.id],
      name: 'fk_sku__product',
    }),
    check('ck_sku__version', sql`${t.version} > 0`),
    check('ck_sku__code', sql`${t.skuCode} ~ '^[A-Za-z0-9\\-_.]{1,40}$'`),
    check('ck_sku__variant_label_len', sql`char_length(${t.variantLabel}) <= 80`),
  ],
)

export const skuAttributeValue = pgTable(
  'sku_attribute_value',
  {
    ...stdSColumns(),
    skuId: uuidId('sku_id').notNull(),
    attributeValueId: uuidId('attribute_value_id').notNull(),
  },
  (t) => [
    unique('uq_sku_attribute_value__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_sku_attribute_value__sku_val').on(t.skuId, t.attributeValueId),
    foreignKey({
      columns: [t.tenantId, t.skuId],
      foreignColumns: [sku.tenantId, sku.id],
      name: 'fk_sku_attr_val__sku',
    }),
    foreignKey({
      columns: [t.tenantId, t.attributeValueId],
      foreignColumns: [attributeValue.tenantId, attributeValue.id],
      name: 'fk_sku_attr_val__attr_value',
    }),
  ],
)

export const skuUom = pgTable(
  'sku_uom',
  {
    ...stdMColumns(),
    skuId: uuidId('sku_id').notNull(),
    uomId: uuidId('uom_id').notNull(),
    conversionFactor: qtyNumeric('conversion_factor').notNull(),
    isBase: boolean('is_base').notNull().default(false),
    barcode: text('barcode'),
  },
  (t) => [
    unique('uq_sku_uom__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_sku_uom__sku_uom').on(t.skuId, t.uomId),
    index('ix_sku_uom__feed').on(t.tenantId, t.version, t.id),
    uniqueIndex('uq_sku_uom__tenant_barcode')
      .on(t.tenantId, t.barcode)
      .where(sql`${t.barcode} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex('uq_sku_uom__sku_base')
      .on(t.skuId)
      .where(sql`${t.isBase} AND ${t.deletedAt} IS NULL`),
    foreignKey({
      columns: [t.tenantId, t.skuId],
      foreignColumns: [sku.tenantId, sku.id],
      name: 'fk_sku_uom__sku',
    }),
    foreignKey({
      columns: [t.tenantId, t.uomId],
      foreignColumns: [uom.tenantId, uom.id],
      name: 'fk_sku_uom__uom',
    }),
    check('ck_sku_uom__version', sql`${t.version} > 0`),
    check('ck_sku_uom__factor_pos', sql`${t.conversionFactor} > 0`),
    check('ck_sku_uom__base_factor_one', sql`NOT ${t.isBase} OR ${t.conversionFactor} = 1`),
    check('ck_sku_uom__barcode_len', sql`char_length(${t.barcode}) BETWEEN 1 AND 64`),
  ],
)

export const itemOutletAvailability = pgTable(
  'item_outlet_availability',
  {
    ...stdMColumns(),
    outletId: uuidId('outlet_id').notNull(),
    productId: uuidId('product_id').notNull(),
    skuId: uuidId('sku_id'),
    status: text('status').notNull(),
    changedAt: isoTimestamptz('changed_at')
      .notNull()
      .default(sql`now()`),
    changedBy: uuidId('changed_by'),
  },
  (t) => [
    unique('uq_item_outlet_availability__tenant_id_id').on(t.tenantId, t.id),
    index('ix_item_outlet_availability__feed').on(t.tenantId, t.outletId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [product.tenantId, product.id],
      name: 'fk_item_outlet_avail__product',
    }),
    check('ck_item_outlet_avail__version', sql`${t.version} > 0`),
    check('ck_item_outlet_avail__status', sql`${t.status} IN ('AVAILABLE', 'UNAVAILABLE')`),
  ],
)

export const priceEntry = pgTable(
  'price_entry',
  {
    ...stdMColumns(),
    skuId: uuidId('sku_id').notNull(),
    uomId: uuidId('uom_id').notNull(),
    outletId: uuidId('outlet_id'),
    price: moneyBigint('price').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('IDR'),
  },
  (t) => [
    unique('uq_price_entry__tenant_id_id').on(t.tenantId, t.id),
    index('ix_price_entry__feed_outlet').on(t.tenantId, t.outletId, t.version, t.id),
    index('ix_price_entry__feed_default')
      .on(t.tenantId, t.version, t.id)
      .where(sql`${t.outletId} IS NULL`),
    foreignKey({
      columns: [t.skuId, t.uomId],
      foreignColumns: [skuUom.skuId, skuUom.uomId],
      name: 'fk_price_entry__sku_uom',
    }),
    foreignKey({
      columns: [t.tenantId, t.skuId],
      foreignColumns: [sku.tenantId, sku.id],
      name: 'fk_price_entry__sku',
    }),
    foreignKey({
      columns: [t.tenantId, t.uomId],
      foreignColumns: [uom.tenantId, uom.id],
      name: 'fk_price_entry__uom',
    }),
    check('ck_price_entry__version', sql`${t.version} > 0`),
    check('ck_price_entry__price_nonneg', sql`${t.price} >= 0`),
    check('ck_price_entry__currency', sql`${t.currency} = 'IDR'`),
  ],
)
