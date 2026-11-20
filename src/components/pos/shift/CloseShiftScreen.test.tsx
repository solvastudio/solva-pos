// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '~/components/ui/Toast'
import { changeLocale } from '~/i18n'
import type { BootResult } from '~/pos/boot/boot'
import { setMeta } from '~/pos/data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '~/pos/db/solva-db'
import { clearSession, startSession } from '~/pos/session/session'
import { openShift } from '~/pos/usecases/shift/open-shift'
import { recordCashMovement } from '~/pos/usecases/shift/record-cash-movement'
import { CloseShiftScreen } from './CloseShiftScreen'

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

const T1 = '0192a000-0000-7000-8000-000000002101'
const OUT = '0192a000-0000-7000-8000-000000002102'
const REG = '0192a000-0000-7000-8000-000000002103'
const DEV = '0192a000-0000-7000-8000-000000002104'
const STAFF = '0192a000-0000-7000-8000-000000002105'
const ROLE = '0192a000-0000-7000-8000-000000002106'
const LE = '0192a000-0000-7000-8000-000000002107'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(async () => {
  cleanup()
  clearSession()
  await deleteTenantDbForTests(T1)
})

describe('CloseShiftScreen (SCR-P13, strict blind count)', () => {
  it('hides expectedCash & variance in DOM before submit, then reveals −Rp2,100 variance after confirmation', async () => {
    const user = userEvent.setup()
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
    await db.role_permission.put({ id: 'rp1', role_id: ROLE, permission_code: 'shift.open_close' })
    await startSession(db, STAFF, OUT)
    await openShift(db, { openingCash: 500_000, staffId: STAFF })
    await recordCashMovement(db, {
      direction: 'IN',
      amount: 200_000,
      reasonCode: 'TOPUP',
      reasonText: 'Float',
      staffId: STAFF,
    })

    // Expected cash = 500,000 + 200,000 = 700,000
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

    const { container } = render(
      <ToastProvider>
        <CloseShiftScreen tenant="demo" bootResult={bootResult} />
      </ToastProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Counted physical cash')).toBeTruthy()
    })

    // CRITICAL blind count check: expected cash 700,000 & variance must NOT exist in DOM before submission
    expect(container.textContent).not.toContain('700,000')
    expect(container.textContent).not.toContain('Variance')

    const countedInput = screen.getByLabelText('Counted physical cash')
    await user.type(countedInput, '697900')
    await user.click(screen.getByRole('button', { name: 'Lock Count & Close Shift' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Lock & Close Shift' })).toBeTruthy()
    })
    await user.click(screen.getByRole('button', { name: 'Lock & Close Shift' }))

    await waitFor(() => {
      expect(screen.getByText('Rp700,000')).toBeTruthy()
      expect(screen.getByText('\u2212Rp2,100')).toBeTruthy()
    })

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, 'landmark-unique': { enabled: false } },
    })
    expect(axeRes.violations).toEqual([])
  })
})
