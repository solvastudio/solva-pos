// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '~/components/ui'
import { changeLocale } from '~/i18n'
import { TransfersTab } from './TransfersTab'

const OUTLET_A = { id: 'o-a', code: 'OUT01', name: 'Outlet A' }
const OUTLET_B = { id: 'o-b', code: 'OUT02', name: 'Outlet B' }

const { optionsMock, destinationsMock, transfersMock } = vi.hoisted(() => ({
  optionsMock: vi.fn(async () => [] as unknown[]),
  destinationsMock: vi.fn(async () => [] as unknown[]),
  transfersMock: vi.fn(async () => [] as unknown[]),
}))

vi.mock('~/hooks/use-current-tenant', () => ({
  useCurrentTenant: () => ({ tenantId: 't1', slug: 'acme', name: 'Acme', basePath: '/acme' }),
}))
vi.mock('~/functions/identity/org.fn', () => ({ listOutletOptionsFn: optionsMock }))
vi.mock('~/functions/inventory/stock-read.fn', () => ({
  listTransfersFn: transfersMock,
  listTransferDestinationsFn: destinationsMock,
  listSkuOptionsFn: async () => [],
  getTransferFn: async () => null,
}))
vi.mock('~/functions/inventory/stock-write.fn', () => ({
  receiveTransferFn: vi.fn(),
  saveTransferDraftFn: vi.fn(),
  sendTransferFn: vi.fn(),
}))

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TransfersTab />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  optionsMock.mockResolvedValue([OUTLET_A])
  destinationsMock.mockResolvedValue([OUTLET_A, OUTLET_B])
  transfersMock.mockResolvedValue([
    { id: 't1', docNo: 'TRF-1', status: 'SENT', fromOutletId: 'o-a', toOutletId: 'o-b', businessDate: '2026-11-20' },
    { id: 't2', docNo: 'TRF-2', status: 'SENT', fromOutletId: 'o-b', toOutletId: 'o-a', businessDate: '2026-11-20' },
    { id: 't3', docNo: 'TRF-3', status: 'RECEIVED', fromOutletId: 'o-a', toOutletId: 'o-gone', businessDate: '2026-11-20' },
  ])
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

describe('TransfersTab', () => {
  it('offers Receive only on transfers whose destination is one of the actor outlets', async () => {
    renderTab()

    // Names come from the destination list, so a destination outside the actor scope still shows its name.
    expect((await screen.findAllByText('Outlet A → Outlet B')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Outlet B → Outlet A').length).toBeGreaterThan(0)

    // The list is rendered once per layout (table and cards). Only TRF-2 (destination = Outlet A)
    // can be received, so there is exactly one Receive button per rendering of TRF-2; TRF-1 has none.
    const copies = screen.getAllByText('TRF-2').length
    expect(screen.getAllByRole('button', { name: 'Receive' })).toHaveLength(copies)
  })

  it('shows a neutral label instead of the raw id for an unknown outlet', async () => {
    renderTab()

    expect((await screen.findAllByText('Outlet A → Other outlet')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/o-gone/)).toBeNull()
  })
})
