import { sql } from 'drizzle-orm'
import { char, check, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'

export const tenant = pgTable(
  'tenant',
  {
    id: uuidId('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    defaultLocale: text('default_locale').notNull().default('id-ID'),
    currency: char('currency', { length: 3 }).notNull().default('IDR'),
    authOrgId: text('auth_org_id'),
    version: moneyBigint('version').notNull().default(1),
    createdAt: isoTimestamptz('created_at').notNull().default(sql`now()`),
    updatedAt: isoTimestamptz('updated_at').notNull().default(sql`now()`),
  },
  (t) => [
    unique('uq_tenant__slug').on(t.slug),
    unique('uq_tenant__auth_org_id').on(t.authOrgId),
    check('ck_tenant__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 40`),
    check('ck_tenant__slug', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'`),
    check('ck_tenant__status', sql`${t.status} IN ('ACTIVE', 'SUSPENDED', 'CLOSED')`),
    check('ck_tenant__default_locale', sql`${t.defaultLocale} IN ('id-ID', 'en-US')`),
    check('ck_tenant__currency', sql`${t.currency} = 'IDR'`),
    check('ck_tenant__version', sql`${t.version} > 0`),
  ],
)
