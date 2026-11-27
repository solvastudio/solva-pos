// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'
import type { PendingInviteItem } from '~/modules/identity/public'
import { PendingInvitesSection } from './PendingInvitesSection'

const invite: PendingInviteItem = {
  id: 'inv-1',
  email: 'ani@example.test',
  displayName: 'Ani',
  roleId: 'role-1',
  outletIds: null,
  issuedBy: null,
  createdAt: '2030-01-01T00:00:00.000Z',
  expiresAt: '2030-01-04T00:00:00.000Z',
  status: 'PENDING',
}

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

describe('PendingInvitesSection', () => {
  it('shows the role name and forwards reissue and cancel to the callbacks', async () => {
    const user = userEvent.setup()
    const onReissue = vi.fn()
    const onCancel = vi.fn()
    render(
      <PendingInvitesSection
        invites={[invite]}
        roleNameById={new Map([['role-1', 'Cashier']])}
        reissuing={false}
        canceling={false}
        onReissue={onReissue}
        onCancel={onCancel}
      />,
    )

    expect(screen.getAllByText('Cashier').length).toBeGreaterThan(0)
    await user.click(screen.getAllByRole('button', { name: 'Reissue' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!)
    expect(onReissue).toHaveBeenCalledWith('inv-1')
    expect(onCancel).toHaveBeenCalledWith('inv-1')
  })

  it('hides the cancel action for expired invitations', () => {
    render(
      <PendingInvitesSection
        invites={[{ ...invite, status: 'EXPIRED' }]}
        roleNameById={new Map()}
        reissuing={false}
        canceling={false}
        onReissue={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Reissue' }).length).toBeGreaterThan(0)
  })
})
