import Dexie, { type Table } from 'dexie'
import { tenantDbName } from '../locks/names'
import { STORES_V1 } from './schema-v1'
import type {
  AppUserRecord,
  CashMasterRecord,
  DeviceLogRow,
  IdRecord,
  LocalCounterRow,
  MetaRow,
  OutboxCommandRow,
  OutletRecord,
  ProductRecord,
  PullStageRow,
  RolePermissionRecord,
  RoleRecord,
  StaffPinRecord,
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
  legal_entity!: Table<IdRecord, string>
  outlet!: Table<OutletRecord, string>
  tax_rate_history!: Table<IdRecord, string>
  register_invoice_prefix!: Table<IdRecord, string>
  outlet_receipt_setting!: Table<IdRecord, string>
  cash_master!: Table<CashMasterRecord, string>
  payment_method!: Table<IdRecord, string>
  feature_flag!: Table<IdRecord, string>
  app_user!: Table<AppUserRecord, string>
  role!: Table<RoleRecord, string>
  role_permission!: Table<RolePermissionRecord, string>
  user_outlet!: Table<UserOutletRecord, string>
  staff_pin!: Table<StaffPinRecord, string>
  category!: Table<IdRecord, string>
  uom!: Table<IdRecord, string>
  product!: Table<ProductRecord, string>
  sku!: Table<IdRecord, string>
  sku_uom!: Table<IdRecord, string>
  price_entry!: Table<IdRecord, string>
  item_outlet_availability!: Table<IdRecord, string>
  modifier_group!: Table<IdRecord, string>
  modifier_group_product!: Table<IdRecord, string>
  modifier!: Table<IdRecord, string>
  fnb_table!: Table<IdRecord, string>

  // Transaction stores
  sale!: Table<IdRecord, string>
  sale_line!: Table<IdRecord, string>
  sale_line_modifier!: Table<IdRecord, string>
  sale_payment!: Table<IdRecord, string>
  credit_note!: Table<IdRecord, string>
  credit_note_line!: Table<IdRecord, string>
  credit_note_refund!: Table<IdRecord, string>
  shift!: Table<IdRecord, string>
  cash_movement!: Table<IdRecord, string>
  bill!: Table<IdRecord, string>
  bill_item!: Table<IdRecord, string>
  bill_item_modifier!: Table<IdRecord, string>
  bill_event!: Table<IdRecord, string>
  staff_pin_state!: Table<Record<string, unknown>, [string, string]>

  // Infrastructure stores
  outbox_command!: Table<OutboxCommandRow, string>
  local_counter!: Table<LocalCounterRow, string>
  print_job!: Table<IdRecord, string>
  device_log!: Table<DeviceLogRow, number>
  stock_snapshot!: Table<Record<string, unknown>, string>
  bill_snapshot!: Table<Record<string, unknown>, string>
  cart_draft!: Table<IdRecord, string>
  asset_cache!: Table<{ key: string; [key: string]: unknown }, string>
  pull_stage!: Table<PullStageRow, number>

  constructor(tenantId: string, onBlocked?: (tenantId: string) => void) {
    if (!isUuid(tenantId)) {
      throw new Error(`SolvaDb requires a valid tenant UUID, got: ${tenantId}`)
    }
    super(tenantDbName(tenantId), { chromeTransactionDurability: 'strict' })
    this.tenantId = tenantId
    this.version(1).stores(STORES_V1)

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
