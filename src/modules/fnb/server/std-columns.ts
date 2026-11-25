import { sql } from 'drizzle-orm'
import { date, integer, text } from 'drizzle-orm/pg-core'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'

export const FNB_APP_VERSION_SEMVER_LITERAL = '^v?\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.+-]+)?$'
export const FNB_TABLE_CODE_LITERAL = '^[A-Za-z0-9\\-_.]{1,10}$'

export function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ')
}

/**
 * Standard Class M columns for F&B master tables synced in master feeds (`fnb_table`).
 */
export function stdFnbMColumns() {
  return {
    id: uuidId('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuidId('tenant_id').notNull(),
    version: moneyBigint('version').notNull(),
    createdAt: isoTimestamptz('created_at').notNull().default(sql`now()`),
    updatedAt: isoTimestamptz('updated_at').notNull().default(sql`now()`),
    createdBy: uuidId('created_by'),
    updatedBy: uuidId('updated_by'),
    deletedAt: isoTimestamptz('deleted_at'),
  }
}

/**
 * Standard Class T transaction header columns for `bill` (SCHEMA §4.5.12).
 */
export function stdFnbTColumns() {
  return {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    outletId: uuidId('outlet_id').notNull(),
    registerId: uuidId('register_id').notNull(),
    deviceId: uuidId('device_id').notNull(),
    createdBy: uuidId('created_by').notNull(),
    createdAtDevice: isoTimestamptz('created_at_device').notNull(),
    clockOffsetMs: integer('clock_offset_ms').notNull(),
    occurredAt: isoTimestamptz('occurred_at').notNull(),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    receivedAt: isoTimestamptz('received_at').notNull().default(sql`now()`),
    commandId: uuidId('command_id').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    appVersion: text('app_version'),
  }
}
