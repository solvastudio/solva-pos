// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '~/components/ui'
import { changeLocale } from '~/i18n'
import { UsersTab } from './UsersTab'

vi.mock('~/queries/identity.queries', () => ({
  membersQueryOptions: () => ({
    queryKey: ['identity', 'acme', 'members', {}],
    queryFn: async () => [],
  }),
  rolesQueryOptions: () => ({
    queryKey: ['identity', 'acme', 'roles'],
    queryFn: async () => [{ id: 'role-1', code: 'CASHIER', name: 'Cashier' }],
  }),
  outletsQueryOptions: () => ({
    queryKey: ['identity', 'acme', 'outlets'],
    queryFn: async () => [{ id: 'out-1', code: 'OUT01', name: 'Main Outlet' }],
  }),
  pendingInvitesQueryOptions: () => ({
    queryKey: ['identity', 'acme', 'pending-invites'],
    queryFn: async () => [],
  }),
}))

function renderUsersTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <UsersTab
          tenantSlug="acme"
          tenantName="Acme"
          permissions={['user.manage', 'user.invite']}
          actorOutletIds={null}
        />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

describe('UsersTab invite form validation', () => {
  it('shows per-field errors and highlights invalid inputs instead of only a generic alert', async () => {
    const user = userEvent.setup()
    renderUsersTab()

    await user.click(screen.getByRole('button', { name: /Invite member/i }))
    const dialog = screen.getByRole('dialog', { name: /Invite member/i })
    await user.click(within(dialog).getByRole('button', { name: /Create invitation code/i }))

    const emailInput = within(dialog).getByLabelText(/^Email$/i)
    const nameInput = within(dialog).getByLabelText(/Display name/i)
    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByText(/Email is required/i)).toBeTruthy()
    expect(within(dialog).getByText(/Display name is required/i)).toBeTruthy()

    await user.type(emailInput, 'not-an-email')
    await user.click(within(dialog).getByRole('button', { name: /Create invitation code/i }))
    expect(within(dialog).getByText(/Enter a valid email address/i)).toBeTruthy()
  })
})
