// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/acme/admin',
  useNavigate: () => vi.fn(),
}))

vi.mock('~/hooks/use-current-tenant', () => ({
  useCurrentTenant: () => ({
    tenantId: 'tenant-1',
    slug: 'acme',
    name: 'Acme Coffee',
    basePath: '/acme',
  }),
}))

vi.mock('~/functions/auth/session.fn', () => ({
  setPreferredLocaleFn: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('~/lib/app-version', () => ({
  APP_VERSION: 'v1.2.3',
}))

import type { AdminSessionView } from '~/functions/auth/session.fn'
import { AdminShell } from './AdminShell'

const TEST_SESSION: AdminSessionView = {
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  appUserId: 'user-1',
  email: 'owner@acme.test',
  displayName: 'Owner',
  locale: 'id-ID',
  preferredLocale: 'id-ID',
  roleCodes: ['OWNER'],
  permissions: [],
  outletIds: null,
  discountLimitPct: 100,
  sessionExpiresAt: '2026-12-01T00:00:00.000Z',
}

beforeEach(async () => {
  await changeLocale('id-ID')
})

afterEach(() => {
  cleanup()
})

describe('AdminShell', () => {
  it('renders app version alongside footer credit without accessibility violations', async () => {
    const { container } = render(
      <AdminShell session={TEST_SESSION}>
        <p>Konten Admin</p>
      </AdminShell>,
    )

    const footer = container.querySelector('footer')
    expect(footer).toBeTruthy()
    expect(footer?.textContent).toContain('www.solvastudio.com')
    expect(footer?.textContent).toContain('Solva POS v1.2.3')
    expect(screen.getByText('Solva POS v1.2.3')).toBeTruthy()

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })

  it('opens mobile drawer with scrim backdrop and closes on backdrop click or Escape', () => {
    render(
      <AdminShell session={TEST_SESSION}>
        <p>Konten Admin</p>
      </AdminShell>,
    )

    const toggle = screen.getByRole('button', { name: 'Buka menu navigasi' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('admin-drawer-backdrop')).toBeNull()

    fireEvent.click(toggle)
    const closeBtn = screen.getByRole('button', { name: 'Tutup menu navigasi' })
    expect(closeBtn.getAttribute('aria-expanded')).toBe('true')
    const backdrop = screen.getByTestId('admin-drawer-backdrop')
    expect(backdrop).toBeTruthy()
    expect(screen.getAllByText('Owner').length).toBeGreaterThanOrEqual(2)

    fireEvent.click(backdrop)
    expect(screen.queryByTestId('admin-drawer-backdrop')).toBeNull()
    expect(screen.getByRole('button', { name: 'Buka menu navigasi' }).getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Buka menu navigasi' }))
    expect(screen.getByTestId('admin-drawer-backdrop')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('admin-drawer-backdrop')).toBeNull()
  })
})
