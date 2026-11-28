// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'
import type { MemberDirectoryView } from '~/modules/identity/shared'
import { EditMemberAccessDialog } from './EditMemberAccessDialog'

const { changeMock } = vi.hoisted(() => ({
  changeMock: vi.fn(async (_input: unknown) => ({ ok: true as const })),
}))

vi.mock('~/functions/identity/members-admin.fn', () => ({
  changeMemberRoleAndOutletsFn: changeMock,
}))

type DialogProps = ComponentProps<typeof EditMemberAccessDialog>

const ROLES = [
  { id: 'role-cashier', code: 'CASHIER', name: 'Cashier' },
  { id: 'role-manager', code: 'MANAGER', name: 'Manager' },
] as unknown as DialogProps['roles']

const OUTLETS = [
  { id: 'out-1', code: 'OUT01', name: 'Main' },
  { id: 'out-2', code: 'OUT02', name: 'Second' },
] as unknown as DialogProps['outlets']

// Legacy data: a different role at each outlet.
const MEMBER: MemberDirectoryView = {
  appUserId: 'user-1',
  displayName: 'Budi',
  email: 'budi@example.test',
  membershipStatus: 'ACTIVE',
  isActive: true,
  pinStatus: 'unset',
  assignments: [
    {
      outletId: 'out-1',
      outletCode: 'OUT01',
      outletName: 'Main',
      roleId: 'role-cashier',
      roleCode: 'CASHIER',
      roleName: 'Cashier',
    },
    {
      outletId: 'out-2',
      outletCode: 'OUT02',
      outletName: 'Second',
      roleId: 'role-manager',
      roleCode: 'MANAGER',
      roleName: 'Manager',
    },
  ],
}

function renderDialog(canTenantWide: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onSaved = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <EditMemberAccessDialog
        member={MEMBER}
        roles={ROLES}
        outlets={OUTLETS}
        canTenantWide={canTenantWide}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  )
  return { onSaved }
}

beforeEach(async () => {
  changeMock.mockClear()
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

describe('EditMemberAccessDialog (one role per member)', () => {
  it('has a single role control and saves the same role for every selected outlet', async () => {
    const user = userEvent.setup()
    const { onSaved } = renderDialog(false)
    const dialog = screen.getByRole('dialog', { name: /Edit role & outlets/i })

    expect(within(dialog).getAllByRole('combobox')).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    expect(changeMock).toHaveBeenCalledWith({
      data: {
        appUserId: 'user-1',
        assignments: [
          { outletId: 'out-1', roleId: 'role-cashier' },
          { outletId: 'out-2', roleId: 'role-cashier' },
        ],
      },
    })
  })

  it('requires at least one outlet and does not call the server without one', async () => {
    const user = userEvent.setup()
    renderDialog(false)
    const dialog = screen.getByRole('dialog', { name: /Edit role & outlets/i })

    await user.click(within(dialog).getByRole('checkbox', { name: /OUT01/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /OUT02/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getByText('Select at least one outlet.')).toBeTruthy()
    expect(changeMock).not.toHaveBeenCalled()
  })

  it('offers the tenant-wide switch only to tenant-wide actors', () => {
    renderDialog(false)
    expect(screen.queryByRole('switch')).toBeNull()
    cleanup()

    renderDialog(true)
    expect(screen.getByRole('switch', { name: /Tenant-wide/i })).toBeTruthy()
  })
})
