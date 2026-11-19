import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { isoTimestamptz, moneyBigint, percentNumeric, uuidId } from '~/server/db/columns'
import { stdMColumns } from './std-columns'

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

export const legalEntity = pgTable(
  'legal_entity',
  {
    ...stdMColumns(),
    name: text('name').notNull(),
    npwp: text('npwp'),
    isPkp: boolean('is_pkp').notNull().default(false),
    pkpSince: date('pkp_since', { mode: 'string' }),
    address: text('address'),
  },
  (t) => [
    unique('uq_legal_entity__tenant_id_id').on(t.tenantId, t.id),
    index('ix_legal_entity__tenant_version_id').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_legal_entity__tenant',
    }),
    uniqueIndex('uq_legal_entity__tenant_npwp')
      .on(t.tenantId, t.npwp)
      .where(sql`${t.npwp} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check('ck_legal_entity__version', sql`${t.version} > 0`),
    check('ck_legal_entity__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 160`),
    check('ck_legal_entity__npwp', sql`${t.npwp} ~ '^\\d{15,16}$'`),
    check('ck_legal_entity__pkp_npwp', sql`${t.isPkp} = false OR ${t.npwp} IS NOT NULL`),
  ],
)

export const outlet = pgTable(
  'outlet',
  {
    ...stdMColumns(),
    legalEntityId: uuidId('legal_entity_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    timezone: text('timezone').notNull().default('Asia/Jakarta'),
    dayCutoffTime: time('day_cutoff_time').notNull().default('00:00'),
    cashRoundingUnit: integer('cash_rounding_unit').notNull().default(100),
    priceTaxMode: text('price_tax_mode').notNull(),
    taxProfile: text('tax_profile').notNull().default('NONE'),
    serviceChargeEnabled: boolean('service_charge_enabled').notNull().default(false),
    serviceChargeRate: percentNumeric('service_charge_rate').notNull().default(sql`0`),
    serviceChargeTaxable: boolean('service_charge_taxable').notNull().default(true),
    inventoryEnabledAt: isoTimestamptz('inventory_enabled_at'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    unique('uq_outlet__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_outlet__tenant_code').on(t.tenantId, t.code),
    index('ix_outlet__tenant_version_id').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_outlet__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
      name: 'fk_outlet__legal_entity',
    }),
    check('ck_outlet__version', sql`${t.version} > 0`),
    check('ck_outlet__code', sql`${t.code} ~ '^[A-Z0-9]{1,10}$'`),
    check('ck_outlet__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check(
      'ck_outlet__timezone',
      sql`${t.timezone} IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura')`,
    ),
    check('ck_outlet__cash_rounding_unit', sql`${t.cashRoundingUnit} IN (0, 100, 500, 1000)`),
    check('ck_outlet__price_tax_mode', sql`${t.priceTaxMode} IN ('INCLUSIVE', 'EXCLUSIVE')`),
    check('ck_outlet__tax_profile', sql`${t.taxProfile} IN ('NONE', 'PPN', 'PB1')`),
    check(
      'ck_outlet__service_charge_rate_range',
      sql`${t.serviceChargeRate} >= 0 AND ${t.serviceChargeRate} <= 100`,
    ),
    check(
      'ck_outlet__service_charge_enabled',
      sql`${t.serviceChargeEnabled} OR ${t.serviceChargeRate} = 0`,
    ),
  ],
)

export const taxRateHistory = pgTable(
  'tax_rate_history',
  {
    ...stdMColumns(),
    taxCode: text('tax_code').notNull(),
    outletId: uuidId('outlet_id'),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    rate: percentNumeric('rate').notNull(),
  },
  (t) => [
    unique('uq_tax_rate_history__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_tax_rate_history__key')
      .on(t.tenantId, t.taxCode, t.outletId, t.effectiveFrom)
      .nullsNotDistinct(),
    index('ix_tax_rate_history__tenant_version_id').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_tax_rate_history__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.outletId],
      foreignColumns: [outlet.tenantId, outlet.id],
      name: 'fk_tax_rate_history__outlet',
    }),
    check('ck_tax_rate_history__version', sql`${t.version} > 0`),
    check('ck_tax_rate_history__tax_code', sql`${t.taxCode} IN ('PPN', 'PB1')`),
    check('ck_tax_rate_history__rate', sql`${t.rate} >= 0 AND ${t.rate} <= 100`),
  ],
)

export const cashMaster = pgTable(
  'cash_master',
  {
    ...stdMColumns(),
    outletId: uuidId('outlet_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    registerType: text('register_type').notNull().default('CASHIER'),
    paperWidthMm: smallint('paper_width_mm').notNull().default(80),
    defaultLocale: text('default_locale'),
  },
  (t) => [
    unique('uq_cash_master__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_cash_master__outlet_code').on(t.outletId, t.code),
    index('ix_cash_master__tenant_version_id').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_cash_master__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.outletId],
      foreignColumns: [outlet.tenantId, outlet.id],
      name: 'fk_cash_master__outlet',
    }),
    check('ck_cash_master__version', sql`${t.version} > 0`),
    check('ck_cash_master__code', sql`${t.code} ~ '^[A-Z0-9]{1,10}$'`),
    check('ck_cash_master__status', sql`${t.status} IN ('ACTIVE', 'INACTIVE')`),
    check('ck_cash_master__register_type', sql`${t.registerType} IN ('CASHIER', 'WAITER')`),
    check('ck_cash_master__paper_width_mm', sql`${t.paperWidthMm} IN (58, 80)`),
    check('ck_cash_master__default_locale', sql`${t.defaultLocale} IN ('id-ID', 'en-US')`),
  ],
)

export const registerInvoicePrefix = pgTable(
  'register_invoice_prefix',
  {
    ...stdMColumns(),
    registerId: uuidId('register_id').notNull(),
    effectiveMonth: date('effective_month', { mode: 'string' }).notNull(),
    invoicePrefix: text('invoice_prefix').notNull(),
  },
  (t) => [
    unique('uq_register_invoice_prefix__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_register_invoice_prefix__reg_month').on(t.registerId, t.effectiveMonth),
    index('ix_register_invoice_prefix__tenant_version_id').on(t.tenantId, t.version, t.id),
    index('ix_register_invoice_prefix__tenant_prefix').on(t.tenantId, t.invoicePrefix),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_register_invoice_prefix__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.registerId],
      foreignColumns: [cashMaster.tenantId, cashMaster.id],
      name: 'fk_register_invoice_prefix__register',
    }),
    check('ck_register_invoice_prefix__version', sql`${t.version} > 0`),
    check(
      'ck_register_invoice_prefix__month_start',
      sql`EXTRACT(day FROM ${t.effectiveMonth}) = 1`,
    ),
    check(
      'ck_register_invoice_prefix__len',
      sql`char_length(${t.invoicePrefix}) BETWEEN 2 AND 16`,
    ),
    check(
      'ck_register_invoice_prefix__format',
      sql`${t.invoicePrefix} ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'`,
    ),
    check('ck_register_invoice_prefix__not_nk', sql`${t.invoicePrefix} !~ '(^|-)NK$'`),
  ],
)

export const outletReceiptSetting = pgTable(
  'outlet_receipt_setting',
  {
    ...stdMColumns(),
    outletId: uuidId('outlet_id').notNull(),
    receiptLocale: text('receipt_locale').notNull().default('id-ID'),
    headerText: text('header_text'),
    footerText: text('footer_text'),
    logoObjectKey: text('logo_object_key'),
    logoSha256: text('logo_sha256'),
  },
  (t) => [
    unique('uq_outlet_receipt_setting__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_outlet_receipt_setting__outlet_id').on(t.outletId),
    index('ix_outlet_receipt_setting__tenant_version_id').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_outlet_receipt_setting__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.outletId],
      foreignColumns: [outlet.tenantId, outlet.id],
      name: 'fk_outlet_receipt_setting__outlet',
    }),
    check('ck_outlet_receipt_setting__version', sql`${t.version} > 0`),
    check(
      'ck_outlet_receipt_setting__locale',
      sql`${t.receiptLocale} IN ('id-ID', 'en-US')`,
    ),
    check('ck_outlet_receipt_setting__header_len', sql`char_length(${t.headerText}) <= 600`),
    check('ck_outlet_receipt_setting__footer_len', sql`char_length(${t.footerText}) <= 600`),
    check('ck_outlet_receipt_setting__logo_key_len', sql`char_length(${t.logoObjectKey}) <= 200`),
    check('ck_outlet_receipt_setting__logo_sha256', sql`${t.logoSha256} ~ '^[0-9a-f]{64}$'`),
  ],
)

export const paymentMethod = pgTable(
  'payment_method',
  {
    ...stdMColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    requiresReference: boolean('requires_reference').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    unique('uq_payment_method__tenant_id_id').on(t.tenantId, t.id),
    index('ix_payment_method__tenant_version_id').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_payment_method__tenant',
    }),
    uniqueIndex('uq_payment_method__tenant_code')
      .on(t.tenantId, t.code)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('uq_payment_method__single_cash')
      .on(t.tenantId)
      .where(sql`${t.kind} = 'CASH' AND ${t.deletedAt} IS NULL`),
    check('ck_payment_method__version', sql`${t.version} > 0`),
    check('ck_payment_method__code', sql`${t.code} ~ '^[A-Z0-9_]{2,20}$'`),
    check('ck_payment_method__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    check('ck_payment_method__kind', sql`${t.kind} IN ('CASH', 'NON_CASH')`),
  ],
)

export const appUser = pgTable(
  'app_user',
  {
    ...stdMColumns(),
    authUserId: text('auth_user_id'),
    displayName: text('display_name').notNull(),
    preferredLocale: text('preferred_locale'),
    isActive: boolean('is_active').notNull().default(true),
    membershipStatus: text('membership_status').notNull().default('ACTIVE'),
  },
  (t) => [
    unique('uq_app_user__tenant_id_id').on(t.tenantId, t.id),
    index('ix_app_user__tenant_version_id').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_app_user__tenant',
    }),
    uniqueIndex('uq_app_user__tenant_display_name')
      .on(t.tenantId, t.displayName)
      .where(sql`${t.deletedAt} IS NULL AND ${t.isActive}`),
    uniqueIndex('uq_app_user__tenant_auth_user')
      .on(t.tenantId, t.authUserId)
      .where(sql`${t.authUserId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index('ix_app_user__auth_user_active')
      .on(t.authUserId)
      .where(sql`${t.authUserId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check('ck_app_user__version', sql`${t.version} > 0`),
    check('ck_app_user__display_name_len', sql`char_length(${t.displayName}) BETWEEN 1 AND 80`),
    check('ck_app_user__preferred_locale', sql`${t.preferredLocale} IN ('id-ID', 'en-US')`),
    check('ck_app_user__membership_status', sql`${t.membershipStatus} IN ('PENDING', 'ACTIVE')`),
    check(
      'ck_app_user__pending_no_auth',
      sql`${t.membershipStatus} = 'ACTIVE' OR ${t.authUserId} IS NULL`,
    ),
  ],
)

export const role = pgTable(
  'role',
  {
    ...stdMColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    discountLimitPct: percentNumeric('discount_limit_pct').notNull().default(sql`0`),
  },
  (t) => [
    unique('uq_role__tenant_id_id').on(t.tenantId, t.id),
    index('ix_role__tenant_version_id').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_role__tenant',
    }),
    uniqueIndex('uq_role__tenant_code')
      .on(t.tenantId, t.code)
      .where(sql`${t.deletedAt} IS NULL`),
    check('ck_role__version', sql`${t.version} > 0`),
    check('ck_role__code', sql`${t.code} ~ '^[A-Z_]{2,30}$'`),
    check(
      'ck_role__discount_limit',
      sql`${t.discountLimitPct} >= 0 AND ${t.discountLimitPct} <= 100`,
    ),
  ],
)

export const permission = pgTable(
  'permission',
  {
    code: text('code').primaryKey(),
    module: text('module').notNull(),
    description: text('description').notNull(),
  },
  (t) => [check('ck_permission__code', sql`${t.code} ~ '^[a-z_.]{3,50}$'`)],
)

export const rolePermission = pgTable(
  'role_permission',
  {
    ...stdMColumns(),
    roleId: uuidId('role_id').notNull(),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permission.code),
  },
  (t) => [
    unique('uq_role_permission__tenant_id_id').on(t.tenantId, t.id),
    unique('uq_role_permission__role_perm').on(t.roleId, t.permissionCode),
    index('ix_role_permission__tenant_version_id').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_role_permission__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.roleId],
      foreignColumns: [role.tenantId, role.id],
      name: 'fk_role_permission__role',
    }),
    check('ck_role_permission__version', sql`${t.version} > 0`),
  ],
)

export const userOutlet = pgTable(
  'user_outlet',
  {
    ...stdMColumns(),
    userId: uuidId('user_id').notNull(),
    outletId: uuidId('outlet_id'),
    roleId: uuidId('role_id').notNull(),
  },
  (t) => [
    unique('uq_user_outlet__tenant_id_id').on(t.tenantId, t.id),
    index('ix_user_outlet__tenant_version_id').on(t.tenantId, t.version, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenant.id],
      name: 'fk_user_outlet__tenant',
    }),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [appUser.tenantId, appUser.id],
      name: 'fk_user_outlet__user',
    }),
    foreignKey({
      columns: [t.tenantId, t.outletId],
      foreignColumns: [outlet.tenantId, outlet.id],
      name: 'fk_user_outlet__outlet',
    }),
    foreignKey({
      columns: [t.tenantId, t.roleId],
      foreignColumns: [role.tenantId, role.id],
      name: 'fk_user_outlet__role',
    }),
    check('ck_user_outlet__version', sql`${t.version} > 0`),
  ],
)
