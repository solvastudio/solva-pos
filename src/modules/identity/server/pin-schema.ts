import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
} from 'drizzle-orm/pg-core'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'
import { device } from './device-schema'
import { appUser, tenant } from './schema'
import { stdMColumns } from './std-columns'

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

export interface PinKdfParams {
  memorySize: number
  iterations: number
  parallelism: number
  hashLength: number
}

/**
 * Class S per-user slow KDF verifier (SCHEMA §4.1.16). Server-only; never synced to devices.
 */
export const userPinCredential = pgTable(
  'user_pin_credential',
  {
    userId: uuidId('user_id').primaryKey(),
    tenantId: uuidId('tenant_id').notNull(),
    kdfAlgo: text('kdf_algo').notNull(),
    kdfParams: jsonb('kdf_params').$type<PinKdfParams>().notNull(),
    kdfSalt: bytea('kdf_salt').notNull(),
    verifier: bytea('verifier').notNull(),
    pinEpoch: integer('pin_epoch').notNull().default(1),
    pinSetAt: isoTimestamptz('pin_set_at').notNull().default(sql`now()`),
    pinSetBy: uuidId('pin_set_by').notNull(),
  },
  (t) => [
    index('ix_user_pin_credential__tenant').on(t.tenantId),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_user_pin_credential__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [appUser.tenantId, appUser.id],
      name: 'fk_user_pin_credential__user',
    }),
    foreignKey({
      columns: [t.tenantId, t.pinSetBy],
      foreignColumns: [appUser.tenantId, appUser.id],
      name: 'fk_user_pin_credential__set_by',
    }),
    check('ck_user_pin_credential__algo', sql`${t.kdfAlgo} IN ('ARGON2ID', 'PBKDF2_SHA256')`),
    check('ck_user_pin_credential__epoch', sql`${t.pinEpoch} >= 1`),
  ],
)

/**
 * Class M per-(user, device) derived PIN hash (`HMAC-SHA256(device_salt, verifier)`) (SCHEMA §4.1.17).
 * Synced strictly filtered by `device_id` so hashes differ across devices even with identical PINs.
 */
export const staffPin = pgTable(
  'staff_pin',
  {
    ...stdMColumns(),
    userId: uuidId('user_id').notNull(),
    deviceId: uuidId('device_id').notNull(),
    deviceSalt: bytea('device_salt').notNull(),
    pinHash: bytea('pin_hash').notNull(),
    kdfAlgo: text('kdf_algo').notNull(),
    kdfParams: jsonb('kdf_params').$type<PinKdfParams>().notNull(),
    kdfSalt: bytea('kdf_salt').notNull(),
    pinEpoch: integer('pin_epoch').notNull(),
  },
  (t) => [
    unique('uq_staff_pin__user_device').on(t.userId, t.deviceId),
    index('ix_staff_pin__feed').on(t.tenantId, t.version, t.id),
    index('ix_staff_pin__device_feed').on(t.tenantId, t.deviceId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_staff_pin__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [appUser.tenantId, appUser.id],
      name: 'fk_staff_pin__user',
    }),
    foreignKey({
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [device.tenantId, device.id],
      name: 'fk_staff_pin__device',
    }),
    check('ck_staff_pin__algo', sql`${t.kdfAlgo} IN ('ARGON2ID', 'PBKDF2_SHA256')`),
    check('ck_staff_pin__epoch', sql`${t.pinEpoch} >= 1`),
    check('ck_staff_pin__version', sql`${t.version} > 0`),
  ],
)

/**
 * Class T-summary device-reported PIN attempt counter and lock state (SCHEMA §4.1.18).
 */
export const staffPinState = pgTable(
  'staff_pin_state',
  {
    userId: uuidId('user_id').notNull(),
    deviceId: uuidId('device_id').notNull(),
    tenantId: uuidId('tenant_id').notNull(),
    failedCount: integer('failed_count').notNull().default(0),
    lockTier: smallint('lock_tier').notNull().default(0),
    lockedUntil: isoTimestamptz('locked_until'),
    lastFailedAt: isoTimestamptz('last_failed_at'),
    pinEpochSeen: integer('pin_epoch_seen').notNull().default(1),
    reportedAt: isoTimestamptz('reported_at').notNull().default(sql`now()`),
    lastDeviceSeq: moneyBigint('last_device_seq').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.deviceId], name: 'pk_staff_pin_state' }),
    index('ix_staff_pin_state__tenant_user').on(t.tenantId, t.userId),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_staff_pin_state__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [appUser.tenantId, appUser.id],
      name: 'fk_staff_pin_state__user',
    }),
    foreignKey({
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [device.tenantId, device.id],
      name: 'fk_staff_pin_state__device',
    }),
    check('ck_staff_pin_state__failed_count', sql`${t.failedCount} BETWEEN 0 AND 15`),
    check('ck_staff_pin_state__lock_tier', sql`${t.lockTier} BETWEEN 0 AND 3`),
    check('ck_staff_pin_state__epoch', sql`${t.pinEpochSeen} >= 1`),
  ],
)
