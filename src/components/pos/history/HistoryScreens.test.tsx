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
import { deleteTenantDbForTests, openTenantDb, type SolvaDb } from '~/pos/db/solva-db'
import { addItem, createEmptyCart } from '~/pos/domain/cart'
import { clearSession, startSession } from '~/pos/session/session'
import { finalizeSale } from '~/pos/usecases/sales/finalize-sale'
import { closeShift } from '~/pos/usecases/shift/close-shift'
import { openShift } from '~/pos/usecases/shift/open-shift'
import { HistoryListScreen } from './HistoryListScreen'
import { SaleDetailScreen } from './SaleDetailScreen'

const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const T1 = '0192a000-0000-7000-8000-00000000e101'
const OUT = '0192a000-0000-7000-8000-00000000e102'
const REG = '0192a000-0000-7000-8000-00000000e103'
const DEV = '0192a000-0000-7000-8000-00000000e104'
const STAFF = '0192a000-0000-7000-8000-00000000e105'
const ROLE = '0192a000-0000-7000-8000-00000000e106'
const LE = '0192a000-0000-7000-8000-00000000e107'
const PM_CASH = '0192a000-0000-7000-8000-00000000e108'

async function seedHistoryDb(): Promise<{ db: SolvaDb; bootResult: BootResult; saleId: string }> {
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
    cash_rounding_unit: 100,
    deleted_at: null,
  })
  await db.legal_entity.put({ id: LE, name: 'PT Demo', npwp: null, is_pkp: false, deleted_at: null })
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
    { id: 'rp2', role_id: ROLE, permission_code: 'shift.open_close' },
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
    finalizeId: '0192a000-0000-7000-8000-00000000e201',
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
    createdAt: '2026-11-20T09:05:00.000Z',
    shiftId: null,
  })
  const added = addItem(
    cart,
    {
      skuId: '0192a000-0000-7000-8000-00000000e301',
      productId: '0192a000-0000-7000-8000-00000000e302',
      uomId: '0192a000-0000-7000-8000-00000000e303',
      skuCode: 'KOP',
      itemName: 'Kopi Tubruk',
      uomCode: 'pcs',
      conversionFactor: '1',
      taxable: false,
      allowFraction: false,
      price: { kind: 'PRICE', price: toMoney(15_000), source: 'DEFAULT' },
    },
    { newId: '0192a000-0000-7000-8000-00000000e304' },
  )
  if (!added.ok) throw new Error('expected ok')
  cart = added.cart

  const sale = await finalizeSale(
    db,
    {
      cart,
      payments: [{ methodId: PM_CASH, methodCode: 'CASH', methodName: 'Tunai', kind: 'CASH', amount: toMoney(15_000) }],
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
  return { db, bootResult, saleId: sale.saleId }
}

beforeEach(async () => {
  await changeLocale('en-US')
  mockNavigate.mockReset()
})

afterEach(async () => {
  cleanup()
  clearSession()
  await deleteTenantDbForTests(T1)
})

describe('HistoryListScreen & SaleDetailScreen (SCR-P10)', () => {
  it('renders sales list, prompts server search for missing invoice, and enforces void disable after close shift', async () => {
    const user = userEvent.setup()
    const { db, bootResult, saleId } = await seedHistoryDb()

    const { container } = render(
      <ToastProvider>
        <HistoryListScreen tenant="demo" bootResult={bootResult} />
      </ToastProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('OUT01-POS01-1126-000001')).toBeTruthy()
    })

    const searchInput = screen.getByLabelText('Search invoice or staff')
    await user.type(searchInput, 'OUT01-999999')
    expect(screen.getByText('Search on Server')).toBeTruthy()

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, 'landmark-unique': { enabled: false } },
    })
    expect(axeRes.violations).toEqual([])

    cleanup()

    // Close shift so sale is from closed shift -> void button must be disabled
    await closeShift(db, { countedCash: 115_000, staffId: STAFF }, { nowMs: () => Date.parse('2026-11-20T10:00:00.000Z') })

    render(
      <ToastProvider>
        <SaleDetailScreen tenant="demo" saleId={saleId} bootResult={bootResult} />
      </ToastProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Kopi Tubruk')).toBeTruthy()
    })
    const voidBtn = screen.getByRole('button', { name: 'Void Invoice' }) as HTMLButtonElement
    expect(voidBtn.disabled).toBe(true)
    expect(screen.getByText('Shift is already closed — issue a return instead.')).toBeTruthy()
  })
})
