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
import { SettingsScreen } from './SettingsScreen'

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

const T1 = '0192a000-0000-7000-8000-000000003101'
const OUT = '0192a000-0000-7000-8000-000000003102'
const REG = '0192a000-0000-7000-8000-000000003103'
const DEV = '0192a000-0000-7000-8000-000000003104'
const STAFF = '0192a000-0000-7000-8000-000000003105'
const ROLE = '0192a000-0000-7000-8000-000000003106'
const LE = '0192a000-0000-7000-8000-000000003107'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(async () => {
  cleanup()
  clearSession()
  await deleteTenantDbForTests(T1)
})

describe('SettingsScreen (SCR-P16)', () => {
  it('renders language, printer, scanner, storage & device info cards, queues TEST job, and passes axe a11y', async () => {
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
    await startSession(db, STAFF, OUT)

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
        <SettingsScreen tenant="demo" bootResult={bootResult} />
      </ToastProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Device Settings')).toBeTruthy()
      expect(screen.getByText('58 mm')).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: 'Test Print' }))
    await waitFor(async () => {
      const jobs = await db.print_job.toArray()
      expect(jobs.some((j) => j.kind === 'TEST')).toBe(true)
    })

    const axeRes = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, 'landmark-unique': { enabled: false } },
    })
    expect(axeRes.violations).toEqual([])
  })
})
