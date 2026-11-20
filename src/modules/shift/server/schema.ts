import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  CASH_MOVEMENT_DIRECTION,
  SHIFT_RECAP_STATUS,
  SHIFT_STATUS,
} from '~/lib/contracts'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'
import { APP_VERSION_SEMVER_LITERAL, stdTColumns } from './std-columns'

function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ')
}

export const cashCashier = pgTable(
  'cash_cashier',
  {
    ...stdTColumns(),
    status: text('status').notNull().default('OPEN'),
    openingCash: moneyBigint('opening_cash').notNull(),
    closedAt: isoTimestamptz('closed_at'),
    closedAtDevice: isoTimestamptz('closed_at_device'),
    closeCommandId: uuidId('close_command_id'),
    countedCash: moneyBigint('counted_cash'),
    countSubmittedAt: isoTimestamptz('count_submitted_at'),
    expectedCashDevice: moneyBigint('expected_cash_device'),
    varianceDevice: moneyBigint('variance_device'),
    expectedCash: moneyBigint('expected_cash'),
    variance: moneyBigint('variance'),
    recapCashSales: moneyBigint('recap_cash_sales'),
    recapCashIn: moneyBigint('recap_cash_in'),
    recapCashOut: moneyBigint('recap_cash_out'),
    recapCashRefund: moneyBigint('recap_cash_refund'),
    recapStatus: text('recap_status').notNull().default('INCOMPLETE'),
    recapComputedAt: isoTimestamptz('recap_computed_at'),
    forceClosedBy: uuidId('force_closed_by'),
    forceCloseReasonText: text('force_close_reason_text'),
    closeNote: text('close_note'),
  },
  (t) => [
    unique('uq_cash_cashier__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_cash_cashier__id_register').on(t.id, t.registerId),
    uniqueIndex('uq_cash_cashier__open_register')
      .on(t.registerId)
      .where(sql`${t.status} = 'OPEN'`),
    index('ix_cash_cashier__tenant_outlet_bd').on(t.tenantId, t.outletId, t.businessDate),
    index('ix_cash_cashier__register_occurred').on(t.registerId, t.occurredAt),
    check('ck_cash_cashier__status', sql.raw(`status IN (${sqlInList(SHIFT_STATUS)})`)),
    check('ck_cash_cashier__opening_cash', sql`${t.openingCash} >= 0`),
    check('ck_cash_cashier__counted_cash', sql`${t.countedCash} >= 0`),
    check('ck_cash_cashier__recap_status', sql.raw(`recap_status IN (${sqlInList(SHIFT_RECAP_STATUS)})`)),
    check('ck_cash_cashier__closed_at', sql`${t.status} = 'OPEN' OR ${t.closedAt} IS NOT NULL`),
    check(
      'ck_cash_cashier__closed_count',
      sql`${t.status} <> 'CLOSED' OR (${t.countedCash} IS NOT NULL AND ${t.countSubmittedAt} IS NOT NULL)`,
    ),
    check(
      'ck_cash_cashier__force_closed',
      sql`${t.status} <> 'FORCE_CLOSED' OR (${t.forceClosedBy} IS NOT NULL AND ${t.forceCloseReasonText} IS NOT NULL AND ${t.countedCash} IS NOT NULL)`,
    ),
    check('ck_cash_cashier__close_note_len', sql`char_length(${t.closeNote}) <= 300`),
    check('ck_cash_cashier__schema_version', sql`${t.schemaVersion} > 0`),
    check(
      'ck_cash_cashier__app_version',
      sql.raw(`char_length(app_version) <= 30 AND app_version ~ '${APP_VERSION_SEMVER_LITERAL}'`),
    ),
  ],
)

export const cashMovement = pgTable(
  'cash_movement',
  {
    ...stdTColumns(),
    shiftId: uuidId('shift_id').notNull(),
    direction: text('direction').notNull(),
    amount: moneyBigint('amount').notNull(),
    reasonCode: text('reason_code').notNull(),
    reasonText: text('reason_text').notNull(),
  },
  (t) => [
    unique('uq_cash_movement__tenant_id_id').on(t.tenantId, t.id),
    index('ix_cash_movement__shift_id').on(t.shiftId),
    index('ix_cash_movement__tenant_outlet_bd').on(t.tenantId, t.outletId, t.businessDate),
    foreignKey({
      columns: [t.tenantId, t.shiftId],
      foreignColumns: [cashCashier.tenantId, cashCashier.id],
      name: 'fk_cash_movement__shift',
    }),
    check('ck_cash_movement__direction', sql.raw(`direction IN (${sqlInList(CASH_MOVEMENT_DIRECTION)})`)),
    check('ck_cash_movement__amount', sql`${t.amount} > 0`),
    check('ck_cash_movement__reason_code_len', sql`char_length(${t.reasonCode}) BETWEEN 1 AND 40`),
    check('ck_cash_movement__reason_text_len', sql`char_length(${t.reasonText}) >= 1`),
    check('ck_cash_movement__schema_version', sql`${t.schemaVersion} > 0`),
    check(
      'ck_cash_movement__app_version',
      sql.raw(`char_length(app_version) <= 30 AND app_version ~ '${APP_VERSION_SEMVER_LITERAL}'`),
    ),
  ],
)
