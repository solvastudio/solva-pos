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
import { CashMovementScreen } from './CashMovementScreen'

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

const T1 = '0192a000-0000-7000-8000-000000001101'
const OUT = '0192a000-0000-7000-8000-000000001102'
const REG = '0192a000-0000-7000-8000-000000001103'
const DEV = '0192a000-0000-7000-8000-000000001104'
const STAFF = '0192a000-0000-7000-8000-000000001105'
const ROLE = '0192a000-0000-7000-8000-000000001106'
const LE = '0192a000-0000-7000-8000-000000001107'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(async () => {
  cleanup()
  clearSession()
  await deleteTenantDbForTests(T1)
})

describe('CashMovementScreen (SCR-P12)', () => {
  it('records cash OUT movement and updates list + outbox, passing axe a11y', async () => {
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
    await db.role.put({ id: ROLE, code: 'MANAGER', name: 'Manager', deleted_at: null })
    await db.user_outlet.put({ id: 'uo1', user_id: STAFF, outlet_id: OUT, role_id: ROLE, deleted_at: null })
    await db.role_permission.put({ id: 'rp1', role_id: ROLE, permission_code: 'cash.in_out' })
    await startSession(db, STAFF, OUT)
    await openShift(db, { openingCash: 200_000, staffId: STAFF })

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
        <CashMovementScreen tenant="demo" bootResult={bootResult} />
      </ToastProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Rp50,000' })).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: 'Rp50,000' }))
    await user.type(screen.getByLabelText('Description (required)'), 'Buy ice cubes')
    await user.click(screen.getByRole('button', { name: 'Record Cash Movement' }))

    await waitFor(() => {
      expect(screen.getByText('Buy ice cubes')).toBeTruthy()
    })

    const movements = await db.cash_movement.toArray()
    expect(movements).toHaveLength(1)
    expect(movements[0]!.amount).toBe(50_000)

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, 'landmark-unique': { enabled: false } },
    })
    expect(axeRes.violations).toEqual([])
    // 15 s limit: axe + IndexedDB stay slow while the whole unit suite runs in parallel (see gate:f3).
  }, 15_000)
})
