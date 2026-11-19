import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value)
  },
  toDriver(value) {
    return value
  },
})

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuidId('id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    chainSeq: moneyBigint('chain_seq').notNull(),
    outletId: uuidId('outlet_id'),
    registerId: uuidId('register_id'),
    deviceId: uuidId('device_id'),
    actorUserId: uuidId('actor_user_id'),
    approverUserId: uuidId('approver_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuidId('entity_id'),
    beforeData: jsonb('before_data'),
    afterData: jsonb('after_data'),
    reasonCode: text('reason_code'),
    reasonText: text('reason_text'),
    occurredAtDevice: isoTimestamptz('occurred_at_device'),
    clockOffsetMs: integer('clock_offset_ms'),
    occurredAt: isoTimestamptz('occurred_at').notNull(),
    recordedAt: isoTimestamptz('recorded_at').notNull().default(sql`now()`),
    businessDate: date('business_date', { mode: 'string' }),
    commandId: uuidId('command_id'),
    requestRef: text('request_ref'),
    schemaVersion: integer('schema_version'),
    appVersion: text('app_version'),
    prevHash: bytea('prev_hash').notNull(),
    rowHash: bytea('row_hash').notNull(),
  },
  (t) => [
    unique('uq_audit_log__tenant_seq').on(t.tenantId, t.chainSeq),
    index('ix_audit_log__tenant_recorded').on(t.tenantId, t.recordedAt),
    index('ix_audit_log__tenant_entity').on(t.tenantId, t.entityType, t.entityId),
    index('ix_audit_log__tenant_action').on(t.tenantId, t.action, t.recordedAt),
    check('ck_audit_log__chain_seq', sql`${t.chainSeq} > 0`),
    check(
      'ck_audit_log__approver_not_actor',
      sql`${t.approverUserId} IS NULL OR ${t.approverUserId} <> ${t.actorUserId}`,
    ),
    check('ck_audit_log__action', sql`${t.action} ~ '^[a-z_.]{3,60}$'`),
    check('ck_audit_log__schema_version', sql`${t.schemaVersion} > 0`),
    check('ck_audit_log__app_version_len', sql`char_length(${t.appVersion}) <= 30`),
    check(
      'ck_audit_log__app_version_semver',
      sql`${t.appVersion} ~ '^v\\d+\\.\\d+\\.\\d+([-+][0-9A-Za-z.+-]+)?$'`,
    ),
  ],
)

export const auditChainHead = pgTable('audit_chain_head', {
  tenantId: uuidId('tenant_id').primaryKey(),
  lastSeq: moneyBigint('last_seq').notNull().default(0),
  lastHash: bytea('last_hash').notNull(),
  updatedAt: isoTimestamptz('updated_at').notNull().default(sql`now()`),
})
