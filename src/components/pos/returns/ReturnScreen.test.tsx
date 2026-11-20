// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '~/components/ui/Toast'
import { changeLocale } from '~/i18n'
import { toMoney } from '~/lib/kernel'
import type { BootResult } from '~/pos/boot/boot'
import { setMeta } from '~/pos/data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '~/pos/db/solva-db'
import { addItem, createEmptyCart, setLineDiscount } from '~/pos/domain/cart'
import { clearSession, startSession } from '~/pos/session/session'
import { finalizeSale } from '~/pos/usecases/sales/finalize-sale'
import { openShift } from '~/pos/usecases/shift/open-shift'
import { ReturnScreen } from './ReturnScreen'

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

const T1 = '0192a000-0000-7000-8000-00000000f101'
const OUT = '0192a000-0000-7000-8000-00000000f102'
const REG = '0192a000-0000-7000-8000-00000000f103'
const DEV = '0192a000-0000-7000-8000-00000000f104'
const STAFF = '0192a000-0000-7000-8000-00000000f105'
const ROLE = '0192a000-0000-7000-8000-00000000f106'
const LE = '0192a000-0000-7000-8000-00000000f107'
const TR = '0192a000-0000-7000-8000-00000000f108'
const PM_CASH = '0192a000-0000-7000-8000-00000000f109'

async function seedReturnDb() {
  const db = await openTenantDb(T1)
  const device = {
    device_id: DEV,
    credential: 'c',
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant_id: T1,
    slug: 'demo',
    register_id: REG,
    outlet_id: OUT,
    register_type: 'CASHIER' as const,
  }
  await setMeta(db, 'device', device)
  await db.outlet.put({
    id: OUT,
    legal_entity_id: LE,
    code: 'OUT01',
    name: 'Outlet 1',
    timezone: 'Asia/Jakarta',
    day_cutoff_time: '04:00',
    price_tax_mode: 'EXCLUSIVE',
    tax_profile: 'PPN',
    cash_rounding_unit: 100,
    deleted_at: null,
  })
  await db.legal_entity.put({ id: LE, name: 'PT Demo', npwp: null, is_pkp: false, deleted_at: null })
  await db.tax_rate_history.put({
    id: TR,
    tax_code: 'PPN',
    outlet_id: null,
    outlet_key: 'TENANT',
    effective_from: '2025-01-01',
    rate: '11',
  })
  await db.cash_master.put({
    id: REG,
    outlet_id: OUT,
    code: 'POS01',
    name: 'Kasir 1',
    register_type: 'CASHIER',
    invoice_prefix: 'OUT01-POS01',
    deleted_at: null,
  })
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
  await db.role_permission.bulkPut([
    { id: 'rp1', role_id: ROLE, permission_code: 'sale.create' },
  ])
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

  await startSession(db, STAFF, OUT)
  const now = () => Date.parse('2026-11-20T09:00:00.000Z')
  await openShift(db, { openingCash: 100_000, staffId: STAFF }, { nowMs: now })

  let cart = createEmptyCart({
    finalizeId: '0192a000-0000-7000-8000-00000000f201',
    config: {
      priceTaxMode: 'EXCLUSIVE',
      taxProfile: 'PPN',
      taxRate: '11',
      serviceChargeEnabled: false,
      serviceChargeRate: '0',
      serviceChargeTaxable: true,
    },
    cashRoundingUnit: 100,
    taxRateId: TR,
    createdAt: '2026-11-20T09:05:00.000Z',
    shiftId: null,
  })
  const added = addItem(
    cart,
    {
      skuId: '0192a000-0000-7000-8000-00000000f301',
      productId: '0192a000-0000-7000-8000-00000000f302',
      uomId: '0192a000-0000-7000-8000-00000000f303',
      skuCode: 'SUS',
      itemName: 'Susu UHT 1L',
      uomCode: 'pcs',
      conversionFactor: '1',
      taxable: true,
      allowFraction: false,
      price: { kind: 'PRICE', price: toMoney(17_900), source: 'OUTLET' },
    },
    { newId: '0192a000-0000-7000-8000-00000000f304', qtyInput: '3' },
  )
  if (!added.ok) throw new Error('expected ok')
  const disc = setLineDiscount(added.cart, added.touchedLineId, { type: 'PERCENT', pct: '10' })
  if (!disc.ok) throw new Error('expected ok')
  cart = disc.cart

  const sale = await finalizeSale(
    db,
    {
      cart,
      payments: [{ methodId: PM_CASH, methodCode: 'CASH', methodName: 'Tunai', kind: 'CASH', amount: toMoney(100_000) }],
      staffId: STAFF,
    },
    { nowMs: now },
  )

  const bootResult: BootResult = {
    kind: 'READY',
    db,
    tenantId: T1,
    slug: 'demo',
    device,
    state: { kind: 'OK' },
    locale: 'en-US',
    tenant: { id: T1, name: 'Demo Toko', default_locale: 'en-US' },
    releaseLock: () => {},
  }
  return { bootResult, saleId: sale.saleId }
}

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(async () => {
  cleanup()
  clearSession()
  vi.restoreAllMocks()
  await deleteTenantDbForTests(T1)
})

describe('ReturnScreen (SCR-P11)', () => {
  it('computes live V-18 preview (Rp17,900) and shows offline EmptyState when remote lookup fails offline', async () => {
    const user = userEvent.setup()
    const { bootResult, saleId } = await seedReturnDb()

    const { container } = render(
      <ToastProvider>
        <ReturnScreen tenant="demo" saleId={saleId} bootResult={bootResult} />
      </ToastProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Susu UHT 1L')).toBeTruthy()
    })

    const plusBtn = screen.getByRole('button', { name: 'Return qty +' })
    await user.click(plusBtn)

    await waitFor(() => {
      expect(screen.getByText('Rp17,900')).toBeTruthy()
    })

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, 'landmark-unique': { enabled: false } },
    })
    expect(axeRes.violations).toEqual([])

    cleanup()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(
      <ToastProvider>
        <ReturnScreen tenant="demo" saleId="lookup" initialInvoiceNo="OUT01-REMOTE-1" bootResult={bootResult} />
      </ToastProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Needs online connection')).toBeTruthy()
    })
  })
})
