// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import axe from 'axe-core'
import { ToastProvider } from '~/components/ui'
import { changeLocale } from '~/i18n'
import type { DeviceView } from '~/modules/identity/shared'
import { RecoverRegisterWizard } from './RecoverRegisterWizard'

const { previewMock, recoverMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  recoverMock: vi.fn(),
}))

vi.mock('~/functions/sales/recovery.fn', () => ({
  previewRecoveryFn: previewMock,
  recoverRegisterFn: recoverMock,
}))

const sampleDevice: DeviceView = {
  id: '01950000-0000-7000-8000-000000000010',
  outletId: '01950000-0000-7000-8000-000000000020',
  outletCode: 'OUT01',
  registerId: '01950000-0000-7000-8000-000000000030',
  registerCode: 'POS02',
  registerName: 'Kasir 2',
  name: 'Tablet Kasir 2',
  enrolledAt: '2026-11-01T00:00:00.000Z',
  revokedAt: null,
  revokeReasonCode: null,
  lastAttemptAt: '2026-11-20T00:00:00.000Z',
  lastSuccessSyncAt: '2026-11-20T00:00:00.000Z',
  pendingCount: 0,
  oldestPendingAt: null,
  clockOffsetMs: 0,
  appVersion: 'v0.1.0',
  schemaVersion: 1,
  storagePersist: 'GRANTED',
  neverSynced: false,
}

describe('RecoverRegisterWizard (FLOW-16, BR-INV-008)', () => {
  beforeEach(async () => {
    await changeLocale('en-US')
    previewMock.mockReset()
    recoverMock.mockReset()
  })

  it('walks through 3 steps, renders BR-INV-008 preview (000125-000127 -> 000128), submits recovery, and passes axe', async () => {
    previewMock.mockResolvedValueOnce({
      ok: true,
      data: {
        registerId: sampleDevice.registerId,
        outletCode: 'OUT01',
        registerCode: 'POS02',
        period: '1126',
        hasActiveDevice: true,
        invoice: {
          docType: 'INVOICE',
          highestReceivedSeq: 124,
          declaredLastSeq: 127,
          nextSeq: 128,
          nextFormattedNo: 'OUT01-POS02-1126-000128',
          gapRange: { seqFrom: 125, seqTo: 127 },
        },
        creditNote: {
          docType: 'CREDIT_NOTE',
          highestReceivedSeq: 0,
          declaredLastSeq: null,
          nextSeq: 1,
          nextFormattedNo: 'OUT01-POS02-NK-1126-000001',
          gapRange: null,
        },
      },
    })
    recoverMock.mockResolvedValueOnce({
      ok: true,
      data: {
        registerId: sampleDevice.registerId,
        period: '1126',
        revokedDeviceId: sampleDevice.id,
        counters: [
          { doc_type: 'INVOICE', period: '1126', next_seq: 128 },
          { doc_type: 'CREDIT_NOTE', period: '1126', next_seq: 1 },
        ],
        createdGaps: [{ docType: 'INVOICE', seqFrom: 125, seqTo: 127 }],
      },
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RecoverRegisterWizard
            tenantSlug="demo-toko"
            target={sampleDevice}
            onOpenChange={onOpenChange}
          />
        </ToastProvider>
      </QueryClientProvider>,
    )

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])

    // Step 1 -> Step 2
    await user.click(screen.getByRole('button', { name: /next|lanjut/i }))
    const invInput = await screen.findByPlaceholderText('000127')
    await user.type(invInput, '127')
    await user.click(screen.getByRole('button', { name: /next|lanjut/i }))

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/000128/)).toBeInTheDocument()
    expect(screen.getByText(/000125.*000127/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /confirm|konfirmasi/i }))
    await waitFor(() => expect(recoverMock).toHaveBeenCalledTimes(1))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
