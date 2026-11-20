import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { COMMAND_TYPE, FLAG_CODE } from '~/lib/contracts'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'

function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ')
}

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

export const idempotencyCommand = pgTable(
  'idempotency_command',
  {
    commandId: uuidId('command_id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    deviceId: uuidId('device_id').notNull(),
    registerId: uuidId('register_id').notNull(),
    outletId: uuidId('outlet_id').notNull(),
    commandType: text('command_type').notNull(),
    channel: text('channel').notNull().default('OUTBOX'),
    schemaVersion: integer('schema_version').notNull(),
    deviceSeq: bigint('device_seq', { mode: 'number' }),
    payloadHash: char('payload_hash', { length: 64 }).notNull(),
    status: text('status').notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    payloadSize: integer('payload_size').notNull().default(0),
    receivedAt: isoTimestamptz('received_at').notNull().default(sql`now()`),
    processedAt: isoTimestamptz('processed_at'),
    durationMs: integer('duration_ms'),
    attemptCount: integer('attempt_count').notNull().default(1),
    requestRef: text('request_ref'),
    appVersion: text('app_version'),
  },
  (t) => [
    unique('uq_idempotency_command__tenant_id_id').on(t.tenantId, t.commandId),
    unique('uq_idempotency_command__device_seq').on(t.deviceId, t.deviceSeq),
    index('ix_idempotency_command__tenant_received').on(t.tenantId, t.receivedAt),
    check('ck_idempotency_command__type', sql.raw(`command_type IN (${sqlInList(COMMAND_TYPE)})`)),
    check('ck_idempotency_command__channel', sql`${t.channel} IN ('OUTBOX', 'ONLINE')`),
    check('ck_idempotency_command__schema_version', sql`${t.schemaVersion} > 0`),
    check(
      'ck_idempotency_command__seq_required',
      sql`${t.channel} = 'ONLINE' OR ${t.deviceSeq} IS NOT NULL`,
    ),
    check('ck_idempotency_command__payload_hash', sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'ck_idempotency_command__status',
      sql`${t.status} IN ('ACKED', 'ATTENTION', 'ACCEPTED_MANUAL', 'DISMISSED')`,
    ),
    check('ck_idempotency_command__online_acked', sql`${t.channel} = 'OUTBOX' OR ${t.status} = 'ACKED'`),
    check('ck_idempotency_command__payload_size', sql`${t.payloadSize} >= 0`),
    check('ck_idempotency_command__attempt_count', sql`${t.attemptCount} >= 1`),
    check('ck_idempotency_command__request_ref', sql`${t.requestRef} ~ '^[A-Za-z0-9._-]{1,64}$'`),
    check(
      'ck_idempotency_command__app_version',
      sql`char_length(${t.appVersion}) <= 30 AND ${t.appVersion} ~ '^v?\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$'`,
    ),
  ],
)

export const attentionItem = pgTable(
  'attention_item',
  {
    id: uuidId('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuidId('tenant_id').notNull(),
    outletId: uuidId('outlet_id').notNull(),
    registerId: uuidId('register_id').notNull(),
    deviceId: uuidId('device_id').notNull(),
    commandId: uuidId('command_id').notNull(),
    commandType: text('command_type').notNull(),
    reasonClass: text('reason_class').notNull(),
    reasonCode: text('reason_code').notNull(),
    detail: text('detail'),
    payload: jsonb('payload').notNull(),
    blockedByCommandId: uuidId('blocked_by_command_id'),
    status: text('status').notNull().default('OPEN'),
    resolutionNote: text('resolution_note'),
    resolvedBy: uuidId('resolved_by'),
    resolvedAt: isoTimestamptz('resolved_at'),
    requestRef: text('request_ref'),
    createdAt: isoTimestamptz('created_at').notNull().default(sql`now()`),
    updatedAt: isoTimestamptz('updated_at').notNull().default(sql`now()`),
  },
  (t) => [
    unique('uq_attention_item__command_id').on(t.commandId),
    unique('uq_attention_item__tenant_id_id').on(t.tenantId, t.id),
    uniqueIndex('ix_attention_item__open_escalated')
      .on(t.tenantId, t.status, t.createdAt, t.id)
      .where(sql`${t.status} IN ('OPEN', 'ESCALATED')`),
    foreignKey({
      columns: [t.tenantId, t.commandId],
      foreignColumns: [idempotencyCommand.tenantId, idempotencyCommand.commandId],
      name: 'fk_attention_item__command',
    }),
    foreignKey({
      columns: [t.tenantId, t.blockedByCommandId],
      foreignColumns: [idempotencyCommand.tenantId, idempotencyCommand.commandId],
      name: 'fk_attention_item__blocked_by',
    }),
    check(
      'ck_attention_item__reason_class',
      sql`${t.reasonClass} IN ('STRUCTURAL', 'AUTHORIZATION')`,
    ),
    check('ck_attention_item__reason_code', sql`${t.reasonCode} ~ '^[A-Z][A-Z0-9_]{1,39}$'`),
    check('ck_attention_item__detail_len', sql`char_length(${t.detail}) <= 500`),
    check(
      'ck_attention_item__status',
      sql`${t.status} IN ('OPEN', 'ACCEPTED', 'DISMISSED', 'ESCALATED')`,
    ),
    check(
      'ck_attention_item__dismissed_note',
      sql`${t.status} <> 'DISMISSED' OR ${t.resolutionNote} IS NOT NULL`,
    ),
    check(
      'ck_attention_item__resolved_at',
      sql`${t.status} IN ('OPEN', 'ESCALATED') OR ${t.resolvedAt} IS NOT NULL`,
    ),
  ],
)

export const dataFlag = pgTable(
  'data_flag',
  {
    id: uuidId('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuidId('tenant_id').notNull(),
    outletId: uuidId('outlet_id').notNull(),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    flagCode: text('flag_code').notNull(),
    severity: text('severity').notNull().default('WARN'),
    entityType: text('entity_type').notNull(),
    entityId: uuidId('entity_id').notNull(),
    parentId: uuidId('parent_id'),
    diffAmount: moneyBigint('diff_amount'),
    detail: jsonb('detail'),
    commandId: uuidId('command_id'),
    status: text('status').notNull().default('OPEN'),
    acknowledgedBy: uuidId('acknowledged_by'),
    acknowledgedAt: isoTimestamptz('acknowledged_at'),
    createdAt: isoTimestamptz('created_at').notNull().default(sql`now()`),
  },
  (t) => [
    unique('uq_data_flag__tenant_entity_code').on(t.tenantId, t.entityType, t.entityId, t.flagCode),
    foreignKey({
      columns: [t.tenantId, t.commandId],
      foreignColumns: [idempotencyCommand.tenantId, idempotencyCommand.commandId],
      name: 'fk_data_flag__command',
    }),
    check('ck_data_flag__flag_code', sql.raw(`flag_code IN (${sqlInList(FLAG_CODE)})`)),
    check('ck_data_flag__severity', sql`${t.severity} IN ('INFO', 'WARN')`),
    check(
      'ck_data_flag__entity_type',
      sql`${t.entityType} IN ('SALE', 'SALE_LINE', 'CREDIT_NOTE', 'STOCK_MOVEMENT', 'BILL', 'TRANSFER_LINE')`,
    ),
    check('ck_data_flag__status', sql`${t.status} IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')`),
  ],
)

const SEMVER_SQL_REGEX = '^v\\d+\\.\\d+\\.\\d+([-+][0-9A-Za-z.+-]+)?$'

export const appRelease = pgTable(
  'app_release',
  {
    appVersion: text('app_version').primaryKey(),
    schemaVersion: integer('schema_version').notNull(),
    releasedAt: isoTimestamptz('released_at')
      .notNull()
      .default(sql`now()`),
    isMandatory: boolean('is_mandatory').notNull().default(false),
    minSupportedSchemaVersion: integer('min_supported_schema_version').notNull(),
    minSupportedAppVersion: text('min_supported_app_version'),
    acceptPreviousUntil: isoTimestamptz('accept_previous_until'),
    notes: text('notes'),
  },
  (t) => [
    index('ix_app_release__released_at').on(sql`${t.releasedAt} DESC`),
    check(
      'ck_app_release__app_version',
      sql.raw(`char_length(app_version) <= 30 AND app_version ~ '${SEMVER_SQL_REGEX}'`),
    ),
    check('ck_app_release__schema_version', sql`${t.schemaVersion} > 0`),
    check(
      'ck_app_release__min_schema',
      sql`${t.minSupportedSchemaVersion} > 0 AND ${t.minSupportedSchemaVersion} <= ${t.schemaVersion}`,
    ),
    check(
      'ck_app_release__min_app',
      sql.raw(
        `min_supported_app_version IS NULL OR (char_length(min_supported_app_version) <= 30 AND min_supported_app_version ~ '${SEMVER_SQL_REGEX}')`,
      ),
    ),
  ],
)
