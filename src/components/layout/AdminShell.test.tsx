// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/acme/admin',
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
})
