import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'
import { appUser, cashMaster, tenant } from './schema'

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

export const pairingCode = pgTable(
  'pairing_code',
  {
    id: uuidId('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuidId('tenant_id').notNull(),
    registerId: uuidId('register_id').notNull(),
    codeHash: bytea('code_hash').notNull(),
    expiresAt: isoTimestamptz('expires_at').notNull(),
    usedAt: isoTimestamptz('used_at'),
    // Composite FK to device(tenant_id, id) is added in custom migration SQL after device exists.
    usedByDeviceId: uuidId('used_by_device_id'),
    createdBy: uuidId('created_by').notNull(),
    createdAt: isoTimestamptz('created_at').notNull().default(sql`now()`),
  },
  (t) => [
    unique('uq_pairing_code__code_hash').on(t.codeHash),
    index('ix_pairing_code__tenant_register').on(t.tenantId, t.registerId),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_pairing_code__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.registerId],
      foreignColumns: [cashMaster.tenantId, cashMaster.id],
      name: 'fk_pairing_code__register',
    }),
    foreignKey({
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [appUser.tenantId, appUser.id],
      name: 'fk_pairing_code__created_by',
    }),
    check('ck_pairing_code__expires_gt_created', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
)

export const device = pgTable(
  'device',
  {
    id: uuidId('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuidId('tenant_id').notNull(),
    registerId: uuidId('register_id').notNull(),
    name: text('name').notNull(),
    credentialHash: bytea('credential_hash').notNull(),
    credentialIssuedAt: isoTimestamptz('credential_issued_at').notNull().default(sql`now()`),
    credentialExpiresAt: isoTimestamptz('credential_expires_at').notNull(),
    pairingCodeId: uuidId('pairing_code_id'),
    userAgent: text('user_agent'),
    enrolledAt: isoTimestamptz('enrolled_at').notNull().default(sql`now()`),
    enrolledBy: uuidId('enrolled_by').notNull(),
    revokedAt: isoTimestamptz('revoked_at'),
    revokedBy: uuidId('revoked_by'),
    revokeReasonCode: text('revoke_reason_code'),
    createdAt: isoTimestamptz('created_at').notNull().default(sql`now()`),
    updatedAt: isoTimestamptz('updated_at').notNull().default(sql`now()`),
  },
  (t) => [
    unique('uq_device__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_device__credential_hash').on(t.credentialHash),
    uniqueIndex('uq_device__active_register')
      .on(t.registerId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('ix_device__tenant_register').on(t.tenantId, t.registerId),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_device__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.registerId],
      foreignColumns: [cashMaster.tenantId, cashMaster.id],
      name: 'fk_device__register',
    }),
    foreignKey({
      columns: [t.pairingCodeId],
      foreignColumns: [pairingCode.id],
      name: 'fk_device__pairing_code',
    }),
    foreignKey({
      columns: [t.tenantId, t.enrolledBy],
      foreignColumns: [appUser.tenantId, appUser.id],
      name: 'fk_device__enrolled_by',
    }),
    foreignKey({
      columns: [t.tenantId, t.revokedBy],
      foreignColumns: [appUser.tenantId, appUser.id],
      name: 'fk_device__revoked_by',
    }),
    check('ck_device__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check('ck_device__user_agent_len', sql`char_length(${t.userAgent}) <= 300`),
    check(
      'ck_device__revoke_reason_code',
      sql`${t.revokeReasonCode} IN ('LOST', 'REPLACED', 'STOLEN', 'OTHER')`,
    ),
  ],
)

export const deviceSyncStatus = pgTable(
  'device_sync_status',
  {
    deviceId: uuidId('device_id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    registerId: uuidId('register_id').notNull(),
    lastAttemptAt: isoTimestamptz('last_attempt_at'),
    lastSuccessSyncAt: isoTimestamptz('last_success_sync_at'),
    lastPushAt: isoTimestamptz('last_push_at'),
    lastPullAt: isoTimestamptz('last_pull_at'),
    pullCursorVersion: moneyBigint('pull_cursor_version'),
    pendingCount: integer('pending_count').notNull().default(0),
    oldestPendingAt: isoTimestamptz('oldest_pending_at'),
    attentionCount: integer('attention_count').notNull().default(0),
    clockOffsetMs: integer('clock_offset_ms'),
    clockOffsetAt: isoTimestamptz('clock_offset_at'),
    appVersion: text('app_version'),
    schemaVersion: integer('schema_version'),
    syncProtocolVersion: integer('sync_protocol_version'),
    storagePersist: text('storage_persist').notNull().default('UNKNOWN'),
    storageUsedPct: smallint('storage_used_pct'),
    lastErrorCode: text('last_error_code'),
    lastErrorRef: text('last_error_ref'),
    updatedAt: isoTimestamptz('updated_at').notNull().default(sql`now()`),
  },
  (t) => [
    index('ix_device_sync_status__tenant_register').on(t.tenantId, t.registerId),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_device_sync_status__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [device.tenantId, device.id],
      name: 'fk_device_sync_status__device',
    }),
    foreignKey({
      columns: [t.tenantId, t.registerId],
      foreignColumns: [cashMaster.tenantId, cashMaster.id],
      name: 'fk_device_sync_status__register',
    }),
    check('ck_device_sync_status__pending_count', sql`${t.pendingCount} >= 0`),
    check('ck_device_sync_status__attention_count', sql`${t.attentionCount} >= 0`),
    check(
      'ck_device_sync_status__storage_persist',
      sql`${t.storagePersist} IN ('GRANTED', 'DENIED', 'UNKNOWN')`,
    ),
    check(
      'ck_device_sync_status__storage_used_pct',
      sql`${t.storageUsedPct} >= 0 AND ${t.storageUsedPct} <= 100`,
    ),
    check(
      'ck_device_sync_status__last_error_code',
      sql`${t.lastErrorCode} ~ '^[A-Z][A-Z0-9_]{1,39}$'`,
    ),
    check(
      'ck_device_sync_status__last_error_ref',
      sql`${t.lastErrorRef} ~ '^[A-Za-z0-9._-]{1,64}$'`,
    ),
  ],
)
