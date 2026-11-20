import { sql } from 'drizzle-orm'
import { date, integer, text } from 'drizzle-orm/pg-core'
import { isoTimestamptz, uuidId } from '~/server/db/columns'

export const APP_VERSION_SEMVER_LITERAL = '^v?\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$'
export const PERIOD_MMYY_LITERAL = '^(0[1-9]|1[0-2])\\d{2}$'

/**
 * Standard Class T transaction header columns (SCHEMA §2.2 `STD-T`).
 */
export function stdTColumns() {
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

/**
 * Shared identity prefix for Class TC transaction child tables (SCHEMA §2.2).
 */
export function stdTCColumns() {
  return {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
  }
}
