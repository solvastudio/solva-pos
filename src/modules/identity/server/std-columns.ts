import { sql } from 'drizzle-orm'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'

/**
 * Standard Class M columns (SCHEMA §2.2 `STD-M`).
 * `tenant_id`, `created_by`, and `updated_by` foreign keys are defined per table
 * or in custom SQL migrations to avoid circular schema references.
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
