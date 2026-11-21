import { sql } from 'drizzle-orm'
import { date, text } from 'drizzle-orm/pg-core'
import { isoTimestamptz, uuidId } from '~/server/db/columns'

/**
 * Kolom standar kelas L (ledger append-only, SCHEMA §2.2 `STD-L`): tanpa `updated_at`, `version`, `deleted_at`.
 */
export function stdLColumns() {
  return {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    outletId: uuidId('outlet_id').notNull(),
    processedAt: isoTimestamptz('processed_at').notNull().default(sql`now()`),
    occurredAt: isoTimestamptz('occurred_at').notNull(),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
  }
}

/**
 * Kolom standar kelas D (dokumen online, SCHEMA §2.2 `STD-D`): tanpa `version` (tidak diunduh device).
 */
export function stdDColumns() {
  return {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    outletId: uuidId('outlet_id').notNull(),
    docNo: text('doc_no').notNull(),
    status: text('status').notNull(),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    createdAt: isoTimestamptz('created_at').notNull().default(sql`now()`),
    updatedAt: isoTimestamptz('updated_at').notNull().default(sql`now()`),
    createdBy: uuidId('created_by').notNull(),
    postedAt: isoTimestamptz('posted_at'),
    postedBy: uuidId('posted_by'),
    note: text('note'),
  }
}

/**
 * Kolom standar kelas S (master server-saja, SCHEMA §2.2 `STD-S`).
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
