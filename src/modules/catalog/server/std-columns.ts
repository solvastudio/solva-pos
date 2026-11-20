import { sql } from 'drizzle-orm'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'

/**
 * Standard Class M columns for catalog tables synced in master feeds (SCHEMA §2.2 `STD-M`).
 */
export function stdMColumns() {
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
 * Standard Class S columns for server-only catalog tables (SCHEMA §2.2 `STD-S`).
 */
export function stdSColumns() {
  return {
    id: uuidId('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuidId('tenant_id').notNull(),
    createdAt: isoTimestamptz('created_at').notNull().default(sql`now()`),
    updatedAt: isoTimestamptz('updated_at').notNull().default(sql`now()`),
    createdBy: uuidId('created_by'),
    updatedBy: uuidId('updated_by'),
    deletedAt: isoTimestamptz('deleted_at'),
  }
}
