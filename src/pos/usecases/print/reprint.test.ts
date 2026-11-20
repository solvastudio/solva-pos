import { afterEach, describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { setMeta } from '../../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../../db/solva-db'
import { addItem, createEmptyCart } from '../../domain/cart'
import { clearSession, startSession } from '../../session/session'
import { finalizeSale } from '../sales/finalize-sale'
import { openShift } from '../shift/open-shift'
import { openDrawerManual, OpenDrawerError } from './open-drawer'
import { reprintSale } from './reprint'

const T1 = '0192a000-0000-7000-8000-000000001b01'
const OUT = '0192a000-0000-7000-8000-000000001b02'
const REG = '0192a000-0000-7000-8000-000000001b03'
const DEV = '0192a000-0000-7000-8000-000000001b04'
const STAFF = '0192a000-0000-7000-8000-000000001b05'
const ROLE = '0192a000-0000-7000-8000-000000001b06'
const LE = '0192a000-0000-7000-8000-000000001b07'
const PM_CASH = '0192a000-0000-7000-8000-000000001b08'

afterEach(async () => {
  clearSession()
  await deleteTenantDbForTests(T1)
})

describe('pos/usecases/print/reprint & open-drawer', () => {
  it('reprints preserving original receipt_locale (FR-I18N-005) and enforces drawer.open + drawer.opened audit', async () => {
    const db = await openTenantDb(T1)
    await setMeta(db, 'device', {
      device_id: DEV,
      credential: 'c',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'demo',
      register_id: REG,
      outlet_id: OUT,
      register_type: 'CASHIER',
    })
    await db.outlet.put({
      id: OUT,
      legal_entity_id: LE,
      code: 'OUT01',
      name: 'Toko',
      timezone: 'Asia/Jakarta',
      day_cutoff_time: '04:00',
      price_tax_mode: 'EXCLUSIVE',
      deleted_at: null,
    })
    await db.outlet_receipt_setting.put({
      id: 'ors1',
      outlet_id: OUT,
      receipt_locale: 'en-US',
      deleted_at: null,
    })
    await db.legal_entity.put({ id: LE, name: 'PT', npwp: null, is_pkp: false, deleted_at: null })
    await db.register_invoice_prefix.put({
      id: 'p1',
      register_id: REG,
      effective_month: '2026-11-01',
      invoice_prefix: 'OUT01-POS01',
      deleted_at: null,
    })
    await db.app_user.put({ id: STAFF, display_name: 'Sari', is_active: true, deleted_at: null })
    await db.staff_pin.put({
      id: 'sp1',
      user_id: STAFF,
      device_salt: 's',
      pin_hash: 'h',
      kdf_algo: 'PBKDF2_SHA256',
      kdf_params: { memorySize: 0, iterations: 1, parallelism: 1, hashLength: 32 },
      kdf_salt: 'ks',
      pin_epoch: 1,
      deleted_at: null,
    })
    await db.role.put({ id: ROLE, code: 'CASHIER', name: 'Cashier', deleted_at: null })
    await db.user_outlet.put({ id: 'uo1', user_id: STAFF, outlet_id: OUT, role_id: ROLE, deleted_at: null })
    await db.role_permission.put({ id: 'rp1', role_id: ROLE, permission_code: 'sale.create' })
    await db.payment_method.put({
      id: PM_CASH,
      code: 'CASH',
      name: 'Tunai',
      kind: 'CASH',
      requires_reference: false,
      sort_order: 1,
      is_active: true,
      deleted_at: null,
    })

    const now = () => Date.parse('2026-11-20T08:00:00.000Z')
    await openShift(db, { openingCash: 100_000, staffId: STAFF }, { nowMs: now })

    let cart = createEmptyCart({
      finalizeId: '0192a000-0000-7000-8000-000000001b99',
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'NONE',
        taxRate: '0',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      },
      cashRoundingUnit: 100,
      taxRateId: null,
      createdAt: '2026-11-20T08:00:00.000Z',
      shiftId: null,
    })
    const add = addItem(
      cart,
      {
        skuId: '0192a000-0000-7000-8000-000000001c01',
        productId: '0192a000-0000-7000-8000-000000001c02',
        uomId: '0192a000-0000-7000-8000-000000001c03',
        skuCode: 'KOP',
        itemName: 'Kopi',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: false,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(10_000), source: 'DEFAULT' },
      },
      { newId: '0192a000-0000-7000-8000-000000001c04' },
    )
    if (!add.ok) throw new Error('ok')
    cart = add.cart
    const fin = await finalizeSale(
      db,
      {
        cart,
        payments: [
          { methodId: PM_CASH, methodCode: 'CASH', methodName: 'Tunai', kind: 'CASH', amount: toMoney(10_000) },
        ],
        staffId: STAFF,
      },
      { nowMs: now },
    )

    // Outlet switches locale afterwards to id-ID -> reprint MUST keep 'en-US'
    await db.outlet_receipt_setting.update('ors1', { receipt_locale: 'id-ID' })
    const reprintJob = await reprintSale(db, fin.saleId)
    expect(reprintJob.kind).toBe('REPRINT')
    expect(reprintJob.receipt_locale).toBe('en-US')

    // Missing drawer.open permission -> FORBIDDEN
    await startSession(db, STAFF, OUT)
    await expect(openDrawerManual(db)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    } satisfies Partial<OpenDrawerError>)

    // Grant drawer.open -> queues CASH_DRAWER + AppendAudit('drawer.opened')
    await db.role_permission.put({ id: 'rp2', role_id: ROLE, permission_code: 'drawer.open' })
    clearSession()
    await startSession(db, STAFF, OUT)
    const drawerJob = await openDrawerManual(db, { reasonText: 'Tuker receh', nowMs: now })
    expect(drawerJob.kind).toBe('CASH_DRAWER')
    const outbox = await db.outbox_command.toArray()
    expect(
      outbox.some(
        (c) =>
          c.type === 'AppendAudit' &&
          (c.payload as { entry: { action: string } }).entry.action === 'drawer.opened',
      ),
    ).toBe(true)
  })
})
