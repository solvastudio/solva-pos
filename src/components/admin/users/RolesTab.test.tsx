// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '~/components/ui'
import { changeLocale } from '~/i18n'
import { RolesTab } from './RolesTab'

const { rolesData, rolesFetches, updateRoleMock } = vi.hoisted(() => ({
  rolesFetches: { count: 0 },
  updateRoleMock: vi.fn(),
  rolesData: [
    {
      id: 'r-owner',
      code: 'OWNER',
      name: 'Owner',
      isSystem: true,
      discountLimitPct: 100,
      permissions: ['sale.create', 'bill.edit', 'role.manage'],
      memberCount: 1,
      heldByActor: false,
      version: 1,
    },
    {
      id: 'r-cashier',
      code: 'CASHIER',
      name: 'Cashier',
      isSystem: true,
      discountLimitPct: 5,
      permissions: ['sale.create'],
      memberCount: 2,
      heldByActor: false,
      version: 3,
    },
    {
      id: 'r-kitchen',
      code: 'KEPALA_DAPUR',
      name: 'Kepala Dapur',
      isSystem: false,
      discountLimitPct: 0,
      permissions: ['bill.edit'],
      memberCount: 0,
      heldByActor: false,
      version: 2,
    },
    {
      id: 'r-busy',
      code: 'SHIFT_LEAD',
      name: 'Shift Lead',
      isSystem: false,
      discountLimitPct: 0,
      permissions: ['bill.edit'],
      memberCount: 2,
      heldByActor: false,
      version: 4,
    },
  ],
}))

vi.mock('~/queries/identity.queries', () => ({
  rolesQueryOptions: () => ({
    queryKey: ['identity', 'acme', 'roles'],
    queryFn: async () => {
      rolesFetches.count += 1
      return rolesData
    },
  }),
  roleMembersQueryOptions: (_slug: string, roleId: string) => ({
    queryKey: ['identity', 'acme', 'role-members', roleId],
    queryFn: async () => [],
  }),
}))

vi.mock('~/functions/identity/role.fn', () => ({
  updateRoleFn: updateRoleMock,
  deleteRoleFn: vi.fn(),
  createRoleFn: vi.fn(),
  duplicateRoleFn: vi.fn(),
}))

function renderTab(overrides: Partial<ComponentProps<typeof RolesTab>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RolesTab
          tenantSlug="acme"
          canEditRoles
          actorPermissions={['role.manage', 'sale.create', 'bill.edit']}
          actorDiscountLimitPct={50}
          {...overrides}
        />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  rolesFetches.count = 0
  updateRoleMock.mockReset()
  for (const r of rolesData) r.heldByActor = false
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

describe('RolesTab', () => {
  it('locks every field of the Owner role and hides its delete button', async () => {
    renderTab()
    const nameInput = (await screen.findByLabelText('Role name')) as HTMLInputElement
    expect(nameInput.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /Delete role/i })).toBeNull()
  })

  it('disables delete for a custom role that still has members', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(await screen.findByRole('button', { name: /Shift Lead/ }))
    const del = (await screen.findByRole('button', { name: /Delete role/i })) as HTMLButtonElement
    expect(del.disabled).toBe(true)
    expect(screen.getByText(/still used by 2 members/i)).toBeTruthy()
  })

  it('enables delete for a custom role without members', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(await screen.findByRole('button', { name: /Kepala Dapur/ }))
    const del = (await screen.findByRole('button', { name: /Delete role/i })) as HTMLButtonElement
    expect(del.disabled).toBe(false)
  })

  it('disables duplicate when the role exceeds the actor permissions', async () => {
    const user = userEvent.setup()
    renderTab({ actorPermissions: ['role.manage'] })
    await user.click(await screen.findByRole('button', { name: /Cashier/ }))
    const dup = (await screen.findByRole('button', { name: /^Duplicate$/i })) as HTMLButtonElement
    expect(dup.disabled).toBe(true)
  })

  it('treats a role assigned to the actor as read-only', async () => {
    const user = userEvent.setup()
    rolesData.find((r) => r.code === 'CASHIER')!.heldByActor = true
    renderTab()
    await user.click(await screen.findByRole('button', { name: /Cashier/ }))
    const nameInput = (await screen.findByLabelText('Role name')) as HTMLInputElement
    expect(nameInput.disabled).toBe(true)
    expect(screen.getByText(/You hold this role yourself/i)).toBeTruthy()
  })

  it('refetches the roles and shows a toast when the save hits a version conflict', async () => {
    const user = userEvent.setup()
    updateRoleMock.mockResolvedValue({ ok: false, errorKey: 'admin.users.role.versionConflict' })
    renderTab()
    await user.click(await screen.findByRole('button', { name: /Kepala Dapur/ }))
    const nameInput = (await screen.findByLabelText('Role name')) as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, 'Kepala Dapur Baru')
    const fetchesBefore = rolesFetches.count

    await user.click(screen.getByRole('button', { name: /^Save role$/i }))

    // Inline alert plus toast carry the same message.
    const matches = await screen.findAllByText(/changed by another admin/i)
    expect(matches.length).toBeGreaterThanOrEqual(2)
    expect(updateRoleMock).toHaveBeenCalledTimes(1)
    expect(updateRoleMock.mock.calls[0]?.[0]).toMatchObject({
      data: { roleId: 'r-kitchen', expectedVersion: 2, name: 'Kepala Dapur Baru' },
    })
    await vi.waitFor(() => expect(rolesFetches.count).toBeGreaterThan(fetchesBefore))
  })

  it('shows a required-name error instead of saving when the name is cleared', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(await screen.findByRole('button', { name: /Kepala Dapur/ }))
    const nameInput = (await screen.findByLabelText('Role name')) as HTMLInputElement
    await user.clear(nameInput)
    await user.click(screen.getByRole('button', { name: /^Save role$/i }))

    expect(await screen.findByText(/Role name is required/i)).toBeTruthy()
    expect(updateRoleMock).not.toHaveBeenCalled()
  })
})
