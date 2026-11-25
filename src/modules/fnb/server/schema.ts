import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  BILL_EVENT_TYPE,
  BILL_HANDOVER_STATUS,
  BILL_ITEM_STATUS,
  BILL_SPLIT_MODE,
  BILL_STATUS,
  DISCOUNT_TYPE,
  PRICE_SOURCE,
} from '~/lib/contracts'
import {
  isoTimestamptz,
  moneyBigint,
  percentNumeric,
  qtyNumeric,
  uuidId,
} from '~/server/db/columns'
import {
  FNB_APP_VERSION_SEMVER_LITERAL,
  FNB_TABLE_CODE_LITERAL,
  sqlInList,
  stdFnbMColumns,
  stdFnbTColumns,
} from './std-columns'

/**
 * F&B dining tables master (Class M, outlet-scoped feed). SCHEMA §4.5.11.
 */
export const fnbTable = pgTable(
  'fnb_table',
  {
    ...stdFnbMColumns(),
    outletId: uuidId('outlet_id').notNull(),
    code: text('code').notNull(),
    area: text('area'),
    capacity: smallint('capacity'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    unique('uq_fnb_table__tenant_id_id').on(t.tenantId, t.id),
    index('ix_fnb_table__feed').on(t.tenantId, t.outletId, t.version, t.id),
    uniqueIndex('uq_fnb_table__outlet_code')
      .on(t.outletId, t.code)
      .where(sql`${t.deletedAt} IS NULL`),
    check('ck_fnb_table__version', sql`${t.version} > 0`),
    check('ck_fnb_table__code', sql.raw(`code ~ '${FNB_TABLE_CODE_LITERAL}'`)),
    check('ck_fnb_table__area_len', sql`${t.area} IS NULL OR char_length(${t.area}) <= 40`),
    check('ck_fnb_table__capacity', sql`${t.capacity} IS NULL OR ${t.capacity} > 0`),
  ],
)

/**
 * F&B open bill projection derived from `bill_event` (Class T/P). SCHEMA §4.5.12.
 * Cross-module FKs and cyclic FK `handover_event_id -> bill_event` are applied in custom migrations.
 */
export const bill = pgTable(
  'bill',
  {
    ...stdFnbTColumns(),
    tableId: uuidId('table_id').notNull(),
    billRef: text('bill_ref').notNull(),
    status: text('status').notNull().default('OPEN'),
    leaseDeviceId: uuidId('lease_device_id').notNull(),
    leaseRegisterId: uuidId('lease_register_id').notNull(),
    handoverStatus: text('handover_status').notNull().default('NONE'),
    handoverTargetRegisterId: uuidId('handover_target_register_id'),
    handoverEventId: uuidId('handover_event_id'),
    handoverRequestedAt: isoTimestamptz('handover_requested_at'),
    prebillSeq: integer('prebill_seq'),
    prebillPrintedAt: isoTimestamptz('prebill_printed_at'),
    lastContentSeq: integer('last_content_seq').notNull().default(0),
    isAwaitingPayment: boolean('is_awaiting_payment').generatedAlwaysAs(
      sql`prebill_seq IS NOT NULL AND prebill_seq > last_content_seq`,
    ),
    parentBillId: uuidId('parent_bill_id'),
    splitMode: text('split_mode'),
    shareIndex: smallint('share_index'),
    shareCount: smallint('share_count'),
    mergedIntoBillId: uuidId('merged_into_bill_id'),
    billDiscountType: text('bill_discount_type'),
    billDiscountPct: percentNumeric('bill_discount_pct'),
    billDiscountInput: moneyBigint('bill_discount_input'),
    billDiscountApprovedBy: uuidId('bill_discount_approved_by'),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    lastEventSeq: integer('last_event_seq').notNull().default(0),
    lastEventAt: isoTimestamptz('last_event_at'),
    closedAt: isoTimestamptz('closed_at'),
  },
  (t) => [
    unique('uq_bill__tenant_id_id').on(t.tenantId, t.id),
    index('ix_bill__tenant_outlet_status').on(t.tenantId, t.outletId, t.status),
    index('ix_bill__tenant_outlet_ref').on(t.tenantId, t.outletId, t.billRef),
    index('ix_bill__table_open')
      .on(t.tenantId, t.tableId)
      .where(sql`${t.status} = 'OPEN'`),
    index('ix_bill__lease_device_open')
      .on(t.tenantId, t.leaseDeviceId)
      .where(sql`${t.status} = 'OPEN'`),
    index('ix_bill__lease_register_open')
      .on(t.tenantId, t.leaseRegisterId)
      .where(sql`${t.status} = 'OPEN'`),
    foreignKey({
      columns: [t.tenantId, t.tableId],
      foreignColumns: [fnbTable.tenantId, fnbTable.id],
      name: 'fk_bill__table',
    }),
    check('ck_bill__ref_len', sql`char_length(${t.billRef}) BETWEEN 1 AND 30`),
    check('ck_bill__status', sql.raw(`status IN (${sqlInList(BILL_STATUS)})`)),
    check(
      'ck_bill__handover_status',
      sql.raw(`handover_status IN (${sqlInList(BILL_HANDOVER_STATUS)})`),
    ),
    check(
      'ck_bill__handover_pending_fields',
      sql`(${t.handoverStatus} = 'PENDING') = (${t.handoverTargetRegisterId} IS NOT NULL AND ${t.handoverEventId} IS NOT NULL)`,
    ),
    check(
      'ck_bill__handover_only_open',
      sql`${t.handoverStatus} = 'NONE' OR ${t.status} = 'OPEN'`,
    ),
    check(
      'ck_bill__merged_target',
      sql`${t.status} <> 'MERGED' OR ${t.mergedIntoBillId} IS NOT NULL`,
    ),
    check(
      'ck_bill__not_self_parent',
      sql`${t.parentBillId} IS NULL OR ${t.parentBillId} <> ${t.id}`,
    ),
    check(
      'ck_bill__split_mode',
      sql.raw(`split_mode IS NULL OR split_mode IN (${sqlInList(BILL_SPLIT_MODE)})`),
    ),
    check(
      'ck_bill__equal_share_fields',
      sql`(${t.splitMode} IS NOT DISTINCT FROM 'EQUAL') = (${t.shareIndex} IS NOT NULL AND ${t.shareCount} IS NOT NULL)`,
    ),
    check(
      'ck_bill__share_bounds',
      sql`${t.shareIndex} IS NULL OR (${t.shareIndex} >= 1 AND ${t.shareIndex} <= ${t.shareCount})`,
    ),
    check(
      'ck_bill__discount_type',
      sql.raw(`bill_discount_type IS NULL OR bill_discount_type IN (${sqlInList(DISCOUNT_TYPE)})`),
    ),
    check(
      'ck_bill__discount_pct',
      sql`${t.billDiscountPct} IS NULL OR (${t.billDiscountPct} >= 0 AND ${t.billDiscountPct} <= 100)`,
    ),
    check(
      'ck_bill__discount_input',
      sql`${t.billDiscountInput} IS NULL OR ${t.billDiscountInput} >= 0`,
    ),
    check('ck_bill__last_event_seq', sql`${t.lastEventSeq} >= 0`),
    check('ck_bill__last_content_seq', sql`${t.lastContentSeq} >= 0`),
    check('ck_bill__schema_version', sql`${t.schemaVersion} > 0`),
    check(
      'ck_bill__app_version',
      sql.raw(
        `app_version IS NULL OR (char_length(app_version) <= 30 AND app_version ~ '${FNB_APP_VERSION_SEMVER_LITERAL}')`,
      ),
    ),
  ],
)

/**
 * Append-only F&B bill event ledger (Class L). SCHEMA §4.5.14.
 */
export const billEvent = pgTable(
  'bill_event',
  {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    outletId: uuidId('outlet_id').notNull(),
    billId: uuidId('bill_id').notNull(),
    billSeq: integer('bill_seq').notNull(),
    deviceId: uuidId('device_id').notNull(),
    registerId: uuidId('register_id').notNull(),
    deviceSeq: moneyBigint('device_seq').notNull(),
    staffId: uuidId('staff_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    reasonCode: text('reason_code'),
    reasonText: text('reason_text'),
    originBillId: uuidId('origin_bill_id'),
    originEventIds: uuidId('origin_event_ids').array(),
    targetRegisterId: uuidId('target_register_id'),
    handoverEventId: uuidId('handover_event_id'),
    createdAtDevice: isoTimestamptz('created_at_device').notNull(),
    clockOffsetMs: integer('clock_offset_ms').notNull(),
    occurredAt: isoTimestamptz('occurred_at').notNull(),
    businessDate: text('business_date').notNull(),
    receivedAt: isoTimestamptz('received_at').notNull().default(sql`now()`),
    commandId: uuidId('command_id').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    appVersion: text('app_version'),
  },
  (t) => [
    unique('uq_bill_event__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_bill_event__bill_seq').on(t.billId, t.billSeq),
    unique('uq_bill_event__device_seq').on(t.deviceId, t.deviceSeq),
    index('ix_bill_event__tenant_bill_seq').on(t.tenantId, t.billId, t.billSeq),
    index('ix_bill_event__tenant_outlet_received').on(t.tenantId, t.outletId, t.receivedAt),
    foreignKey({
      columns: [t.tenantId, t.billId],
      foreignColumns: [bill.tenantId, bill.id],
      name: 'fk_bill_event__bill',
    }),
    check('ck_bill_event__bill_seq', sql`${t.billSeq} > 0`),
    check('ck_bill_event__device_seq', sql`${t.deviceSeq} > 0`),
    check('ck_bill_event__event_type', sql.raw(`event_type IN (${sqlInList(BILL_EVENT_TYPE)})`)),
    check('ck_bill_event__schema_version', sql`${t.schemaVersion} > 0`),
    check(
      'ck_bill_event__app_version',
      sql.raw(
        `app_version IS NULL OR (char_length(app_version) <= 30 AND app_version ~ '${FNB_APP_VERSION_SEMVER_LITERAL}')`,
      ),
    ),
  ],
)

/**
 * Projected active/voided/moved items inside an open bill (Class P). SCHEMA §4.5.13.
 */
export const billItem = pgTable(
  'bill_item',
  {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    outletId: uuidId('outlet_id').notNull(),
    billId: uuidId('bill_id').notNull(),
    lineNo: integer('line_no').notNull(),
    skuId: uuidId('sku_id').notNull(),
    uomId: uuidId('uom_id').notNull(),
    skuCode: text('sku_code').notNull(),
    itemName: text('item_name').notNull(),
    uomCode: text('uom_code').notNull(),
    qty: qtyNumeric('qty').notNull(),
    conversionFactor: qtyNumeric('conversion_factor').notNull(),
    unitPrice: moneyBigint('unit_price').notNull(),
    priceSource: text('price_source').notNull(),
    isOpenPrice: boolean('is_open_price').notNull().default(false),
    taxable: boolean('taxable').notNull().default(true),
    discountType: text('discount_type'),
    discountPct: percentNumeric('discount_pct'),
    discountInput: moneyBigint('discount_input'),
    discountApprovedBy: uuidId('discount_approved_by'),
    note: text('note'),
    status: text('status').notNull().default('ACTIVE'),
    voidReasonCode: text('void_reason_code'),
    voidReasonText: text('void_reason_text'),
    originBillId: uuidId('origin_bill_id'),
    originItemId: uuidId('origin_item_id'),
    createdEventId: uuidId('created_event_id').notNull(),
  },
  (t) => [
    unique('uq_bill_item__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_bill_item__bill_line_no').on(t.billId, t.lineNo),
    index('ix_bill_item__tenant_bill').on(t.tenantId, t.billId),
    foreignKey({
      columns: [t.tenantId, t.billId],
      foreignColumns: [bill.tenantId, bill.id],
      name: 'fk_bill_item__bill',
    }),
    foreignKey({
      columns: [t.tenantId, t.createdEventId],
      foreignColumns: [billEvent.tenantId, billEvent.id],
      name: 'fk_bill_item__created_event',
    }),
    check('ck_bill_item__line_no', sql`${t.lineNo} > 0`),
    check('ck_bill_item__item_name_len', sql`char_length(${t.itemName}) <= 200`),
    check('ck_bill_item__qty', sql`${t.qty} > 0`),
    check('ck_bill_item__conversion_factor', sql`${t.conversionFactor} > 0`),
    check('ck_bill_item__unit_price', sql`${t.unitPrice} >= 0`),
    check('ck_bill_item__price_source', sql.raw(`price_source IN (${sqlInList(PRICE_SOURCE)})`)),
    check(
      'ck_bill_item__discount_type',
      sql.raw(`discount_type IS NULL OR discount_type IN (${sqlInList(DISCOUNT_TYPE)})`),
    ),
    check(
      'ck_bill_item__discount_pct',
      sql`${t.discountPct} IS NULL OR (${t.discountPct} >= 0 AND ${t.discountPct} <= 100)`,
    ),
    check('ck_bill_item__discount_input', sql`${t.discountInput} IS NULL OR ${t.discountInput} >= 0`),
    check(
      'ck_bill_item__discount_null_pair',
      sql`(${t.discountType} IS NULL) = (${t.discountPct} IS NULL AND ${t.discountInput} IS NULL)`,
    ),
    check('ck_bill_item__note_len', sql`${t.note} IS NULL OR char_length(${t.note}) <= 200`),
    check('ck_bill_item__status', sql.raw(`status IN (${sqlInList(BILL_ITEM_STATUS)})`)),
    check(
      'ck_bill_item__void_reason',
      sql`${t.status} <> 'VOIDED' OR ${t.voidReasonText} IS NOT NULL`,
    ),
  ],
)

/**
 * Snapshot modifier choices attached to a `bill_item` projection. SCHEMA §4.5.13.
 */
export const billItemModifier = pgTable(
  'bill_item_modifier',
  {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    billItemId: uuidId('bill_item_id').notNull(),
    modifierId: uuidId('modifier_id').notNull(),
    name: text('name').notNull(),
    priceDelta: moneyBigint('price_delta').notNull(),
    qty: smallint('qty').notNull().default(1),
  },
  (t) => [
    unique('uq_bill_item_modifier__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_bill_item_modifier__item_mod').on(t.billItemId, t.modifierId),
    index('ix_bill_item_modifier__tenant_item').on(t.tenantId, t.billItemId),
    foreignKey({
      columns: [t.tenantId, t.billItemId],
      foreignColumns: [billItem.tenantId, billItem.id],
      name: 'fk_bill_item_modifier__item',
    }),
    check('ck_bill_item_modifier__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    check('ck_bill_item_modifier__qty', sql`${t.qty} >= 1`),
  ],
)
