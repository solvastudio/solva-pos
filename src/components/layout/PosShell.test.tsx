// @vitest-environment jsdom
import { changeLocale } from '~/i18n'
import { cleanup, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getGlobalSyncStore } from '~/pos/sync'
import { PosShell } from './PosShell'

beforeEach(async () => {
  await changeLocale('en-US')
  getGlobalSyncStore().patch({
    conn: 'OFFLINE',
    queue: { pending: 3, oldestAt: '2026-11-20T01:00:00.000Z', attention: 0 },
    device: 'LEASE_WARNING',
    leaseHoursLeft: 10,
    update: 'NONE',
    lastSuccessAt: '2026-11-20T01:00:00.000Z',
    clockWarning: true,
    syncingSinceMs: null,
  })
})

afterEach(() => {
  cleanup()
})

describe('PosShell + SyncIndicator + Banners (CMP-17)', () => {
  it('renders sync indicator, additive pending chip, and caps stacked banners at 2 with 0 axe violations', async () => {
    const onSyncNow = vi.fn()
    const { container } = render(
      <PosShell tenantName="Acme Coffee" tenantSlug="acme" registerName="POS 01" onSyncNow={onSyncNow}>
        <main>
          <p>POS Content</p>
        </main>
      </PosShell>,
    )

    const ind = screen.getByTestId('sync-indicator')
    expect(ind.textContent).toContain('Offline')
    expect(ind.textContent).toContain('3 pending')

    // Highest priority 2 banners shown (lease_warning + offline); clock_warning (3rd) stays capped out
    expect(screen.getByText(/within 10 hours/i)).toBeTruthy()
    expect(screen.getByText(/Offline\. Sales are still saved/i)).toBeTruthy()
    expect(screen.queryByText(/Clock differs/i)).toBeNull()

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })
})
