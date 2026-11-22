import { sql } from 'drizzle-orm'
import { date, text } from 'drizzle-orm/pg-core'
import { isoTimestamptz, uuidId } from '~/server/db/columns'

/**
 * Standard columns for class L (append-only ledger, SCHEMA §2.2 `STD-L`): no `updated_at`, `version`, or `deleted_at`.
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
 * Standard columns for class D (online documents, SCHEMA §2.2 `STD-D`): no `version` (devices do not download it).
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
 * Standard columns for class S (server-only master, SCHEMA §2.2 `STD-S`).
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
