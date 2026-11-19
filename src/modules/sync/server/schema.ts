import { sql } from 'drizzle-orm'
import { check, pgTable } from 'drizzle-orm/pg-core'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'

export const tenantSync = pgTable(
  'tenant_sync',
  {
    // Foreign key to tenant(id) is added in SQL migration 0003 to keep schema modules decoupled.
    tenantId: uuidId('tenant_id').primaryKey(),
    version: moneyBigint('version').notNull().default(0),
    tombstoneFloorVersion: moneyBigint('tombstone_floor_version').notNull().default(0),
    floorUpdatedAt: isoTimestamptz('floor_updated_at'),
    updatedAt: isoTimestamptz('updated_at').notNull().default(sql`now()`),
  },
  (t) => [
    check('ck_tenant_sync__version', sql`${t.version} >= 0`),
    check(
      'ck_tenant_sync__floor',
      sql`${t.tombstoneFloorVersion} >= 0 AND ${t.tombstoneFloorVersion} <= ${t.version}`,
    ),
  ],
)
