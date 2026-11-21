import '@tanstack/react-start/server-only'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { buildFeedSource, omitWireColumns, type FeedSource } from '~/modules/sync/public'
import { staffPin } from './pin-schema'
import {
  appUser,
  cashMaster,
  featureFlag,
  legalEntity,
  outlet,
  outletReceiptSetting,
  paymentMethod,
  registerInvoicePrefix,
  role,
  rolePermission,
  taxRateHistory,
  tenant,
  userOutlet,
} from './schema'

function encodeBytesBase64Url(val: unknown): unknown {
  if (Buffer.isBuffer(val)) return val.toString('base64url')
  if (val instanceof Uint8Array) return Buffer.from(val).toString('base64url')
  return val
}

/**
 * Constructs `FeedSource` adapters for all 12 Identity master entities in sync-order,
 * enforcing device/outlet scope and stripping internal or sensitive columns.
 */
export function identityFeedSources(): FeedSource[] {
  return [
    buildFeedSource({
      entity: 'tenant',
      table: tenant,
      columns: {
        id: tenant.id,
        tenantId: tenant.id,
        version: tenant.version,
        deletedAt: null,
      },
      selectScopeWhere: (scope) => eq(tenant.id, scope.tenantId),
      inScope: (row, scope) => row.id === scope.tenantId,
      project: (row) => omitWireColumns(row, ['auth_org_id']),
    }),

    buildFeedSource({
      entity: 'legal_entity',
      table: legalEntity,
      columns: {
        id: legalEntity.id,
        tenantId: legalEntity.tenantId,
        version: legalEntity.version,
        deletedAt: legalEntity.deletedAt,
      },
    }),

    buildFeedSource({
      entity: 'outlet',
      table: outlet,
      columns: {
        id: outlet.id,
        tenantId: outlet.tenantId,
        version: outlet.version,
        deletedAt: outlet.deletedAt,
      },
      selectScopeWhere: (scope) => eq(outlet.id, scope.outletId),
      inScope: (row, scope) => row.id === scope.outletId,
      // Kolom time PostgreSQL mengembalikan HH:MM:SS; klien memakai HH:MM (sama dengan enrollment).
      project: (row) => ({
        ...row,
        day_cutoff_time: String(row.day_cutoff_time ?? '00:00').slice(0, 5),
      }),
    }),

    buildFeedSource({
      entity: 'outlet_receipt_setting',
      table: outletReceiptSetting,
      columns: {
        id: outletReceiptSetting.id,
        tenantId: outletReceiptSetting.tenantId,
        version: outletReceiptSetting.version,
        deletedAt: outletReceiptSetting.deletedAt,
      },
      selectScopeWhere: (scope) => eq(outletReceiptSetting.outletId, scope.outletId),
      inScope: (row, scope) => row.outlet_id === scope.outletId,
      project: (row) => omitWireColumns(row, ['logo_object_key']),
    }),

    buildFeedSource({
      entity: 'cash_master',
      table: cashMaster,
      columns: {
        id: cashMaster.id,
        tenantId: cashMaster.tenantId,
        version: cashMaster.version,
        deletedAt: cashMaster.deletedAt,
      },
      selectScopeWhere: (scope) => eq(cashMaster.outletId, scope.outletId),
      inScope: (row, scope) => row.outlet_id === scope.outletId,
    }),

    buildFeedSource({
      entity: 'register_invoice_prefix',
      table: registerInvoicePrefix,
      columns: {
        id: registerInvoicePrefix.id,
        tenantId: registerInvoicePrefix.tenantId,
        version: registerInvoicePrefix.version,
        deletedAt: registerInvoicePrefix.deletedAt,
      },
      snapshotScopeWhere: (scope) => eq(registerInvoicePrefix.registerId, scope.registerId),
      inScope: (row, scope) => row.register_id === scope.registerId,
    }),

    buildFeedSource({
      entity: 'tax_rate_history',
      table: taxRateHistory,
      columns: {
        id: taxRateHistory.id,
        tenantId: taxRateHistory.tenantId,
        version: taxRateHistory.version,
        deletedAt: taxRateHistory.deletedAt,
      },
      snapshotScopeWhere: (scope) =>
        or(eq(taxRateHistory.outletId, scope.outletId), isNull(taxRateHistory.outletId)),
      inScope: (row, scope) => row.outlet_id === null || row.outlet_id === scope.outletId,
    }),

    buildFeedSource({
      entity: 'payment_method',
      table: paymentMethod,
      columns: {
        id: paymentMethod.id,
        tenantId: paymentMethod.tenantId,
        version: paymentMethod.version,
        deletedAt: paymentMethod.deletedAt,
      },
    }),

    buildFeedSource({
      entity: 'feature_flag',
      table: featureFlag,
      columns: {
        id: featureFlag.id,
        tenantId: featureFlag.tenantId,
        version: featureFlag.version,
        deletedAt: featureFlag.deletedAt,
      },
      purgeBelowFloor: true,
      project: (row) =>
        omitWireColumns(row, ['tenant_id', 'created_at', 'updated_at', 'deleted_at', 'note']),
    }),

    buildFeedSource({
      entity: 'role',
      table: role,
      columns: {
        id: role.id,
        tenantId: role.tenantId,
        version: role.version,
        deletedAt: role.deletedAt,
      },
    }),

    buildFeedSource({
      entity: 'role_permission',
      table: rolePermission,
      columns: {
        id: rolePermission.id,
        tenantId: rolePermission.tenantId,
        version: rolePermission.version,
        deletedAt: rolePermission.deletedAt,
      },
    }),

    buildFeedSource({
      entity: 'app_user',
      table: appUser,
      columns: {
        id: appUser.id,
        tenantId: appUser.tenantId,
        version: appUser.version,
        deletedAt: appUser.deletedAt,
      },
      liveOnlyWhere: (scope) =>
        and(
          eq(appUser.membershipStatus, 'ACTIVE'),
          eq(appUser.isActive, true),
          sql`EXISTS (
            SELECT 1 FROM user_outlet uo
            WHERE uo.tenant_id = ${scope.tenantId}::uuid
              AND uo.user_id = ${appUser.id}
              AND uo.deleted_at IS NULL
              AND (uo.outlet_id = ${scope.outletId}::uuid OR uo.outlet_id IS NULL)
          )`,
        ),
      inScope: async (row, scope, tx) => {
        if (row.membership_status !== 'ACTIVE' || row.is_active !== true) {
          return false
        }
        const userId = String(row.id)
        const res = await tx.execute(
          sql`SELECT 1 FROM user_outlet
              WHERE tenant_id = ${scope.tenantId}::uuid
                AND user_id = ${userId}::uuid
                AND deleted_at IS NULL
                AND (outlet_id = ${scope.outletId}::uuid OR outlet_id IS NULL)
              LIMIT 1`,
        )
        return res.rows.length > 0
      },
      project: (row) => omitWireColumns(row, ['auth_user_id', 'membership_status']),
    }),

    buildFeedSource({
      entity: 'user_outlet',
      table: userOutlet,
      columns: {
        id: userOutlet.id,
        tenantId: userOutlet.tenantId,
        version: userOutlet.version,
        deletedAt: userOutlet.deletedAt,
      },
      snapshotScopeWhere: (scope) =>
        or(eq(userOutlet.outletId, scope.outletId), isNull(userOutlet.outletId)),
      liveOnlyWhere: (scope) =>
        sql`EXISTS (
          SELECT 1 FROM app_user au
          WHERE au.tenant_id = ${scope.tenantId}::uuid
            AND au.id = ${userOutlet.userId}
            AND au.deleted_at IS NULL
            AND au.membership_status = 'ACTIVE'
            AND au.is_active = true
        )`,
      inScope: async (row, scope, tx) => {
        const outId = row.outlet_id
        if (outId !== null && outId !== scope.outletId) {
          return false
        }
        const userId = String(row.user_id)
        const res = await tx.execute(
          sql`SELECT 1 FROM app_user
              WHERE tenant_id = ${scope.tenantId}::uuid
                AND id = ${userId}::uuid
                AND deleted_at IS NULL
                AND membership_status = 'ACTIVE'
                AND is_active = true
              LIMIT 1`,
        )
        return res.rows.length > 0
      },
    }),

    buildFeedSource({
      entity: 'staff_pin',
      table: staffPin,
      columns: {
        id: staffPin.id,
        tenantId: staffPin.tenantId,
        version: staffPin.version,
        deletedAt: staffPin.deletedAt,
      },
      selectScopeWhere: (scope) => eq(staffPin.deviceId, scope.deviceId),
      inScope: (row, scope) => row.device_id === scope.deviceId,
      project: (row) => {
        const clean = omitWireColumns(row, ['tenant_id', 'device_id', 'created_at'])
        return {
          ...clean,
          device_salt: encodeBytesBase64Url(clean.device_salt),
          pin_hash: encodeBytesBase64Url(clean.pin_hash),
          kdf_salt: encodeBytesBase64Url(clean.kdf_salt),
        }
      },
    }),
  ]
}
