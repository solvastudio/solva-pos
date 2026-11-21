import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, primaryKey, text, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { isoTimestamptz, moneyBigint, qtyNumeric, uuidId } from '~/server/db/columns'
import {
  COST_BASIS,
  GOODS_RECEIPT_DOC_TYPES,
  GOODS_RECEIPT_STATUSES,
  MOVEMENT_TYPES,
  sqlInList,
  STOCK_SOURCE_TYPES,
  STOCKTAKE_SCOPES,
  STOCKTAKE_STATUSES,
  TRANSFER_STATUSES,
} from '../domain/movement-types'
import { stdDColumns, stdLColumns, stdSColumns } from './std-columns'

/**
 * Skema inventori F4 (SCHEMA §4.3.2–4.3.7). FK lintas modul & komposit tenant ditambahkan di migrasi kustom
 * (pola Fase 30/40); kolom `tenant_id` dan RLS dipasang di migrasi kustom juga.
 */

/** Saldo per (outlet, SKU): kelas P, dibaca device lewat snapshot terpisah. Tanpa CHECK qty ≥ 0 (DB-02). */
export const stockBalance = pgTable(
  'stock_balance',
  {
    outletId: uuidId('outlet_id').notNull(),
    skuId: uuidId('sku_id').notNull(),
    tenantId: uuidId('tenant_id').notNull(),
    qty: qtyNumeric('qty').notNull().default(sql`0`),
    inventoryValue: moneyBigint('inventory_value').notNull().default(sql`0`),
    refValue: moneyBigint('ref_value').notNull().default(sql`0`),
    refQty: qtyNumeric('ref_qty').notNull().default(sql`0`),
    rev: moneyBigint('rev').notNull().default(sql`0`),
    lastMovementAt: isoTimestamptz('last_movement_at'),
    updatedAt: isoTimestamptz('updated_at').notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ name: 'pk_stock_balance', columns: [t.outletId, t.skuId] }),
    check('ck_stock_balance__ref_qty', sql`${t.refQty} >= 0`),
    check('ck_stock_balance__qty_scale', sql`${t.qty} = trunc(${t.qty}, 4)`),
    check('ck_stock_balance__zero_value', sql`${t.qty} <> 0 OR ${t.inventoryValue} = 0`),
    index('ix_stock_balance__negative')
      .on(t.tenantId, t.outletId)
      .where(sql`${t.qty} < 0`),
  ],
)

/** Kartu stok / ledger (kelas L, append-only; UPDATE/DELETE dicabut dan ditolak trigger). */
export const stockMovement = pgTable(
  'stock_movement',
  {
    ...stdLColumns(),
    skuId: uuidId('sku_id').notNull(),
    movementType: text('movement_type').notNull(),
    qtyDelta: qtyNumeric('qty_delta').notNull(),
    valueDelta: moneyBigint('value_delta').notNull(),
    qtyAfter: qtyNumeric('qty_after').notNull(),
    valueAfter: moneyBigint('value_after').notNull(),
    balSeq: moneyBigint('bal_seq').notNull(),
    costBasis: text('cost_basis').notNull(),
    isNegativeResult: boolean('is_negative_result').notNull().default(false),
    sourceType: text('source_type').notNull(),
    sourceId: uuidId('source_id').notNull(),
    reversesMovementId: uuidId('reverses_movement_id'),
    commandId: uuidId('command_id'),
    createdBy: uuidId('created_by'),
  },
  (t) => [
    unique('uq_stock_movement__source').on(t.tenantId, t.sourceType, t.sourceId, t.skuId, t.movementType),
    unique('uq_stock_movement__bal_seq').on(t.outletId, t.skuId, t.balSeq),
    index('ix_stock_movement__sku_seq').on(t.tenantId, t.outletId, t.skuId, t.balSeq),
    index('ix_stock_movement__business_date').on(t.tenantId, t.outletId, t.businessDate),
    check('ck_stock_movement__movement_type', sql`${t.movementType} IN (${sql.raw(sqlInList(MOVEMENT_TYPES))})`),
    check('ck_stock_movement__cost_basis', sql`${t.costBasis} IN (${sql.raw(sqlInList(COST_BASIS))})`),
    check('ck_stock_movement__source_type', sql`${t.sourceType} IN (${sql.raw(sqlInList(STOCK_SOURCE_TYPES))})`),
    check('ck_stock_movement__qty_delta', sql`${t.qtyDelta} <> 0 AND ${t.qtyDelta} = trunc(${t.qtyDelta}, 4)`),
    check(
      'ck_stock_movement__sign',
      sql`(${t.qtyDelta} > 0 AND ${t.valueDelta} >= 0) OR (${t.qtyDelta} < 0 AND ${t.valueDelta} <= 0) OR ${t.valueDelta} = 0`,
    ),
    check('ck_stock_movement__zero_value_after', sql`${t.qtyAfter} <> 0 OR ${t.valueAfter} = 0`),
  ],
)

/** Pemasok referensi sederhana (kelas S, server-saja). */
export const supplier = pgTable(
  'supplier',
  {
    ...stdSColumns(),
    name: text('name').notNull(),
    contact: text('contact'),
  },
  (t) => [
    uniqueIndex('uq_supplier__tenant_name')
      .on(t.tenantId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    check('ck_supplier__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check('ck_supplier__contact_len', sql`${t.contact} IS NULL OR char_length(${t.contact}) <= 200`),
  ],
)

/** Dokumen penerimaan barang (kelas D). `REVERSAL` membuat movement berlawanan (BR-STK-022). */
export const goodsReceipt = pgTable(
  'goods_receipt',
  {
    ...stdDColumns(),
    docType: text('doc_type').notNull().default('RECEIPT'),
    supplierId: uuidId('supplier_id'),
    reversalOfId: uuidId('reversal_of_id'),
    totalValue: moneyBigint('total_value').notNull().default(sql`0`),
    supplierRef: text('supplier_ref'),
  },
  (t) => [
    unique('uq_goods_receipt__doc_no').on(t.tenantId, t.docNo),
    uniqueIndex('uq_goods_receipt__reversal_of')
      .on(t.reversalOfId)
      .where(sql`${t.reversalOfId} IS NOT NULL`),
    check('ck_goods_receipt__doc_type', sql`${t.docType} IN (${sql.raw(sqlInList(GOODS_RECEIPT_DOC_TYPES))})`),
    check('ck_goods_receipt__status', sql`${t.status} IN (${sql.raw(sqlInList(GOODS_RECEIPT_STATUSES))})`),
    check(
      'ck_goods_receipt__reversal_link',
      sql`(${t.docType} = 'REVERSAL') = (${t.reversalOfId} IS NOT NULL)`,
    ),
    check('ck_goods_receipt__reversal_posted', sql`${t.docType} <> 'REVERSAL' OR ${t.status} = 'POSTED'`),
    check('ck_goods_receipt__total_value', sql`${t.totalValue} >= 0`),
    check('ck_goods_receipt__supplier_ref_len', sql`${t.supplierRef} IS NULL OR char_length(${t.supplierRef}) <= 60`),
  ],
)

export const goodsReceiptLine = pgTable(
  'goods_receipt_line',
  {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    goodsReceiptId: uuidId('goods_receipt_id').notNull(),
    lineNo: integer('line_no').notNull(),
    skuId: uuidId('sku_id').notNull(),
    uomId: uuidId('uom_id').notNull(),
    qty: qtyNumeric('qty').notNull(),
    conversionFactor: qtyNumeric('conversion_factor').notNull(),
    qtyBase: qtyNumeric('qty_base').notNull(),
    unitCost: moneyBigint('unit_cost'),
    lineValue: moneyBigint('line_value').notNull(),
  },
  (t) => [
    unique('uq_goods_receipt_line__line_no').on(t.goodsReceiptId, t.lineNo),
    check('ck_goods_receipt_line__qty', sql`${t.qty} > 0`),
    check('ck_goods_receipt_line__factor', sql`${t.conversionFactor} > 0`),
    check('ck_goods_receipt_line__qty_base', sql`${t.qtyBase} > 0`),
    check('ck_goods_receipt_line__unit_cost', sql`${t.unitCost} IS NULL OR ${t.unitCost} >= 0`),
    check('ck_goods_receipt_line__line_value', sql`${t.lineValue} >= 0`),
  ],
)

/** Transfer antar outlet dua langkah (kelas D). `outlet_id` = outlet asal (STD-D). */
export const transfer = pgTable(
  'transfer',
  {
    ...stdDColumns(),
    toOutletId: uuidId('to_outlet_id').notNull(),
    sentAt: isoTimestamptz('sent_at'),
    sentBy: uuidId('sent_by'),
    receivedAt: isoTimestamptz('received_at'),
    receivedBy: uuidId('received_by'),
    closeReasonCode: text('close_reason_code'),
    closeReasonText: text('close_reason_text'),
  },
  (t) => [
    unique('uq_transfer__doc_no').on(t.tenantId, t.docNo),
    check('ck_transfer__outlets', sql`${t.toOutletId} <> ${t.outletId}`),
    check('ck_transfer__status', sql`${t.status} IN (${sql.raw(sqlInList(TRANSFER_STATUSES))})`),
    check('ck_transfer__sent', sql`${t.status} <> 'SENT' OR (${t.sentAt} IS NOT NULL AND ${t.sentBy} IS NOT NULL)`),
    check('ck_transfer__received', sql`${t.status} <> 'RECEIVED' OR ${t.receivedAt} IS NOT NULL`),
    index('ix_transfer__in_transit')
      .on(t.tenantId, t.toOutletId)
      .where(sql`${t.status} = 'SENT'`),
  ],
)

export const transferLine = pgTable(
  'transfer_line',
  {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    transferId: uuidId('transfer_id').notNull(),
    lineNo: integer('line_no').notNull(),
    skuId: uuidId('sku_id').notNull(),
    uomId: uuidId('uom_id').notNull(),
    qtyInput: qtyNumeric('qty_input').notNull(),
    conversionFactor: qtyNumeric('conversion_factor').notNull(),
    qtySentBase: qtyNumeric('qty_sent_base').notNull(),
    valueSent: moneyBigint('value_sent'),
    qtyReceivedBase: qtyNumeric('qty_received_base'),
    valueReceived: moneyBigint('value_received'),
    qtyVarianceBase: qtyNumeric('qty_variance_base'),
    valueVariance: moneyBigint('value_variance'),
  },
  (t) => [
    unique('uq_transfer_line__line_no').on(t.transferId, t.lineNo),
    check('ck_transfer_line__qty_input', sql`${t.qtyInput} > 0`),
    check('ck_transfer_line__factor', sql`${t.conversionFactor} > 0`),
    check('ck_transfer_line__qty_sent', sql`${t.qtySentBase} > 0`),
    check(
      'ck_transfer_line__qty_received',
      sql`${t.qtyReceivedBase} IS NULL OR (${t.qtyReceivedBase} BETWEEN 0 AND ${t.qtySentBase})`,
    ),
  ],
)

/** Dokumen stock opname (kelas D). Snapshot saldo diambil saat dokumen dibuat (BR-STK-030/031). */
export const stocktake = pgTable(
  'stocktake',
  {
    ...stdDColumns(),
    scope: text('scope').notNull().default('SELECTED'),
    snapshotAt: isoTimestamptz('snapshot_at').notNull(),
  },
  (t) => [
    unique('uq_stocktake__doc_no').on(t.tenantId, t.docNo),
    check('ck_stocktake__status', sql`${t.status} IN (${sql.raw(sqlInList(STOCKTAKE_STATUSES))})`),
    check('ck_stocktake__scope', sql`${t.scope} IN (${sql.raw(sqlInList(STOCKTAKE_SCOPES))})`),
  ],
)

export const stocktakeLine = pgTable(
  'stocktake_line',
  {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    stocktakeId: uuidId('stocktake_id').notNull(),
    skuId: uuidId('sku_id').notNull(),
    snapshotQty: qtyNumeric('snapshot_qty').notNull(),
    countedQty: qtyNumeric('counted_qty'),
    deltaQty: qtyNumeric('delta_qty').generatedAlwaysAs(sql`counted_qty - snapshot_qty`),
    deltaValue: moneyBigint('delta_value'),
  },
  (t) => [
    unique('uq_stocktake_line__sku').on(t.stocktakeId, t.skuId),
    check('ck_stocktake_line__counted', sql`${t.countedQty} IS NULL OR ${t.countedQty} >= 0`),
  ],
)

/** Pengikat tabel dipakai migrasi kustom (ekspor agar tes skema dapat memeriksa daftar tabel). */
export const INVENTORY_TABLE_NAMES = [
  'stock_balance',
  'stock_movement',
  'supplier',
  'goods_receipt',
  'goods_receipt_line',
  'transfer',
  'transfer_line',
  'stocktake',
  'stocktake_line',
] as const

