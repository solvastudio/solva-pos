import Dexie, { type Table, type Transaction } from 'dexie'
import { tenantDbName } from '../locks/names'
import { migrateOutbox } from './migrations/outbox-migrate'
import { STORES_V1 } from './schema-v1'
import type {
  AssetCacheRecord,
  AppUserRecord,
  CartDraftRecord,
  CashMasterRecord,
  CashMovementRecord,
  CategoryRecord,
  CreditNoteLineRecord,
  CreditNoteRecord,
  CreditNoteRefundRecord,
  DeviceLogRow,
  FeatureFlagRecord,
  IdRecord,
  ItemOutletAvailabilityRecord,
  LegalEntityRecord,
  LocalCounterRow,
  MetaRow,
  OutboxCommandRow,
  OutletReceiptSettingRecord,
  OutletRecord,
  PaymentMethodRecord,
  PriceEntryRecord,
  PrintJobRecord,
  ProductRecord,
  PullStageRow,
  RegisterInvoicePrefixRecord,
  RolePermissionRecord,
  RoleRecord,
  SaleLineRecord,
  SalePaymentRecord,
  SaleRecord,
  ShiftRecord,
  SkuRecord,
  SkuUomRecord,
  StaffPinRecord,
  StaffPinStateRecord,
  StockSnapshotRecord,
  TaxRateHistoryRecord,
  UomRecord,
  UserOutletRecord,
} from './types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export class SolvaDb extends Dexie {
  readonly tenantId: string

  meta!: Table<MetaRow, string>

  // Master stores
  legal_entity!: Table<LegalEntityRecord, string>
  outlet!: Table<OutletRecord, string>
  tax_rate_history!: Table<TaxRateHistoryRecord, string>
  register_invoice_prefix!: Table<RegisterInvoicePrefixRecord, string>
  outlet_receipt_setting!: Table<OutletReceiptSettingRecord, string>
  cash_master!: Table<CashMasterRecord, string>
  payment_method!: Table<PaymentMethodRecord, string>
  feature_flag!: Table<FeatureFlagRecord, string>
  app_user!: Table<AppUserRecord, string>
  role!: Table<RoleRecord, string>
  role_permission!: Table<RolePermissionRecord, string>
  user_outlet!: Table<UserOutletRecord, string>
  staff_pin!: Table<StaffPinRecord, string>
  category!: Table<CategoryRecord, string>
  uom!: Table<UomRecord, string>
  product!: Table<ProductRecord, string>
  sku!: Table<SkuRecord, string>
  sku_uom!: Table<SkuUomRecord, string>
  price_entry!: Table<PriceEntryRecord, string>
  item_outlet_availability!: Table<ItemOutletAvailabilityRecord, string>
  modifier_group!: Table<IdRecord, string>
  modifier_group_product!: Table<IdRecord, string>
  modifier!: Table<IdRecord, string>
  fnb_table!: Table<IdRecord, string>

  // Transaction stores
  sale!: Table<SaleRecord, string>
  sale_line!: Table<SaleLineRecord, string>
  sale_line_modifier!: Table<IdRecord, string>
  sale_payment!: Table<SalePaymentRecord, string>
  credit_note!: Table<CreditNoteRecord, string>
  credit_note_line!: Table<CreditNoteLineRecord, string>
  credit_note_refund!: Table<CreditNoteRefundRecord, string>
  shift!: Table<ShiftRecord, string>
  cash_movement!: Table<CashMovementRecord, string>
  bill!: Table<IdRecord, string>
  bill_item!: Table<IdRecord, string>
  bill_item_modifier!: Table<IdRecord, string>
  bill_event!: Table<IdRecord, string>
  staff_pin_state!: Table<StaffPinStateRecord, [string, string]>

  // Infrastructure stores
  outbox_command!: Table<OutboxCommandRow, string>
  local_counter!: Table<LocalCounterRow, string>
  print_job!: Table<PrintJobRecord, string>
  device_log!: Table<DeviceLogRow, number>
  stock_snapshot!: Table<StockSnapshotRecord, string>
  bill_snapshot!: Table<Record<string, unknown>, string>
  cart_draft!: Table<CartDraftRecord, string>
  asset_cache!: Table<AssetCacheRecord, string>
  pull_stage!: Table<PullStageRow, number>

  constructor(tenantId: string, onBlocked?: (tenantId: string) => void) {
    if (!isUuid(tenantId)) {
      throw new Error(`SolvaDb requires a valid tenant UUID, got: ${tenantId}`)
    }
    super(tenantDbName(tenantId), { chromeTransactionDurability: 'strict' })
    this.tenantId = tenantId
    this.version(1).stores(STORES_V1)
    this.registerUpgradeHooks()

    this.on('versionchange', () => {
      this.close()
      openDbPromises.delete(tenantId)
      if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('solva:db-versionchange', { detail: { tenantId } }))
      }
    })

    this.on('blocked', () => {
      onBlocked?.(tenantId)
    })
  }

  /**
   * Scaffold hook for future IndexedDB schema bumps (`version(N)`):
   * future `this.version(N).stores(...).upgrade(tx => this.runUpgrade(tx, N - 1, N))`
   * invokes `migrateOutbox` atomically inside the Dexie upgrade transaction so no
   * pending command is dropped across `N-1 -> N` upgrades.
   */
  protected registerUpgradeHooks(): void {
    // Dexie v1 baseline is active; future version(2)+ attaches `runUpgrade(tx, from, to)`.
  }

  protected async runUpgrade(tx: Transaction, fromVersion: number, toVersion: number): Promise<void> {
    await migrateOutbox(tx, fromVersion, toVersion)
    const metaTable = tx.table('meta')
    await metaTable.put({ key: 'dexie_version', value: toVersion })
  }
}

const openDbPromises = new Map<string, Promise<SolvaDb>>()

/**
 * Returns the single open `SolvaDb` instance for `tenantId` in this tab and
 * ensures initial `meta.dexie_version = 1` is persisted on first open.
 */
export function openTenantDb(
  tenantId: string,
  options?: { onBlocked?: (tenantId: string) => void },
): Promise<SolvaDb> {
  if (!isUuid(tenantId)) {
    return Promise.reject(new Error(`Invalid tenantId UUID: ${tenantId}`))
  }
  const existing = openDbPromises.get(tenantId)
  if (existing) {
    return existing
  }

  const opening = (async () => {
    const db = new SolvaDb(tenantId, options?.onBlocked)
    await db.open()
    await db.transaction('rw', db.meta, async () => {
      const ver = await db.meta.get('dexie_version')
      if (!ver) {
        await db.meta.put({ key: 'dexie_version', value: 1 })
      }
    })
    return db
  })().catch((err) => {
    openDbPromises.delete(tenantId)
    throw err
  })

  openDbPromises.set(tenantId, opening)
  return opening
}

export function closeTenantDb(tenantId: string): void {
  const pending = openDbPromises.get(tenantId)
  openDbPromises.delete(tenantId)
  if (pending) {
    void pending
      .then((db) => {
        db.close()
      })
      .catch(() => {})
  }
}

export async function deleteTenantDbForTests(tenantId: string): Promise<void> {
  closeTenantDb(tenantId)
  await Dexie.delete(tenantDbName(tenantId))
}
