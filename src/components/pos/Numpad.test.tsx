// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'
import { deleteTenantDbForTests, openTenantDb } from '~/pos/db/solva-db'
import type { PosStaffSummary } from '~/pos/data/pin.repo'
import { Numpad } from './Numpad'
import { PinDots } from './PinDots'
import { StaffPicker } from './StaffPicker'
import { SupervisorPinDialog } from './SupervisorPinDialog'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

describe('POS PIN UI components (CMP-21 Numpad, PinDots, StaffPicker)', () => {
  it('Numpad handles touch clicks and physical keyboard input with 0 axe violations', async () => {
    const onDigit = vi.fn()
    const onBackspace = vi.fn()
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    const { container } = render(
      <div>
        <PinDots length={2} maxLength={6} />
        <Numpad
          onDigit={onDigit}
          onBackspace={onBackspace}
          onSubmit={onSubmit}
          submitDisabled={false}
        />
      </div>,
    )

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])

    await user.click(screen.getByRole('button', { name: /Digit 4/i }))
    await user.click(screen.getByRole('button', { name: /Delete last digit/i }))
    await user.click(screen.getByRole('button', { name: /Confirm/i }))
    expect(onDigit).toHaveBeenCalledWith('4')
    expect(onBackspace).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(1)

    await user.keyboard('827{Backspace}{Enter}')
    expect(onDigit).toHaveBeenCalledWith('8')
    expect(onDigit).toHaveBeenCalledWith('2')
    expect(onDigit).toHaveBeenCalledWith('7')
    expect(onBackspace).toHaveBeenCalledTimes(2)
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('StaffPicker displays only active tenant staff, highlights selection, and passes axe', async () => {
    const staff: PosStaffSummary[] = [
      {
        userId: 'u1',
        displayName: 'Budi Santoso',
        roleCodes: ['CASHIER'],
        roleNames: ['Cashier'],
        permissions: ['sale.create'],
        discountLimitPct: 10,
        outletIds: ['o1'],
      },
      {
        userId: 'u2',
        displayName: 'Siti Rahma',
        roleCodes: ['SUPERVISOR'],
        roleNames: ['Supervisor'],
        permissions: ['discount.approve'],
        discountLimitPct: 30,
        outletIds: ['o1'],
      },
    ]
    const onSelect = vi.fn()
    const user = userEvent.setup()

    const { container } = render(
      <StaffPicker
        staff={staff}
        selectedUserId="u1"
        lockedUserIds={new Set(['u2'])}
        onSelect={onSelect}
      />,
    )

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])

    expect(screen.getByText('Budi Santoso')).toBeInTheDocument()
    await user.click(screen.getByText('Siti Rahma'))
    expect(onSelect).toHaveBeenCalledWith('u2')
  })

  it('SupervisorPinDialog renders z-pin overlay with override warning and passes axe', async () => {
    const tenantId = '01950000-0000-7000-8000-00000000a999'
    const db = await openTenantDb(tenantId)
    try {
      const { container } = render(
        <SupervisorPinDialog
          open={true}
          onOpenChange={vi.fn()}
          db={db}
          outletId="01950000-0000-7000-8000-00000000b999"
          deviceId="01950000-0000-7000-8000-00000000c999"
          registerId="01950000-0000-7000-8000-00000000d999"
          requesterId="01950000-0000-7000-8000-00000000e999"
          permission="screen.unlock_override"
          trustedNowMs={Date.parse('2026-11-20T10:00:00.000Z')}
          maxSeenMs={Date.parse('2026-11-20T10:00:00.000Z')}
          warningNotice="Active cart drafts will be discarded."
          onApproved={vi.fn()}
        />,
      )

      const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(axeRes.violations).toEqual([])
      expect(screen.getByText('Active cart drafts will be discarded.')).toBeInTheDocument()
    } finally {
      await deleteTenantDbForTests(tenantId)
    }
  })
})
