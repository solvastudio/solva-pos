// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'
import type { SanitizedOutboxQueueItem } from '~/pos/data/outbox.repo'
import { QueueView } from './QueueScreen'
import { ServerBehindBanner } from './ServerBehindBanner'
import { UpdateDialog } from './UpdateDialog'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

const SAMPLE_ITEMS: SanitizedOutboxQueueItem[] = [
  {
    id: 'cmd-1',
    type: 'FinalizeSale',
    deviceSeq: 1,
    status: 'PENDING',
    schemaHeld: false,
    schemaHoldCode: null,
    attempts: 0,
    nextRetryAt: null,
    errorCode: null,
    errorClass: null,
    errorRef: null,
    managerDecision: null,
    referenceLabel: 'OUT01-01-202611-0001',
    createdAtDevice: '2026-11-20T01:00:00.000Z',
    ackedAt: null,
  },
  {
    id: 'cmd-2',
    type: 'FinalizeSale',
    deviceSeq: 2,
    status: 'SENDING',
    schemaHeld: false,
    schemaHoldCode: null,
    attempts: 1,
    nextRetryAt: null,
    errorCode: null,
    errorClass: null,
    errorRef: null,
    managerDecision: null,
    referenceLabel: 'OUT01-01-202611-0002',
    createdAtDevice: '2026-11-20T01:01:00.000Z',
    ackedAt: null,
  },
  {
    id: 'cmd-3',
    type: 'FinalizeCreditNote',
    deviceSeq: 3,
    status: 'NEEDS_ATTENTION',
    schemaHeld: false,
    schemaHoldCode: null,
    attempts: 1,
    nextRetryAt: null,
    errorCode: 'RETURN_EXCEEDS_QTY',
    errorClass: 'STRUCTURAL',
    errorRef: 'att-ref-3',
    managerDecision: null,
    referenceLabel: 'CN01-01-202611-0001',
    createdAtDevice: '2026-11-20T01:02:00.000Z',
    ackedAt: null,
  },
  {
    id: 'cmd-4',
    type: 'RecordCashMovement',
    deviceSeq: 4,
    status: 'PENDING',
    schemaHeld: true,
    schemaHoldCode: 'SERVER_BEHIND',
    attempts: 0,
    nextRetryAt: null,
    errorCode: 'SERVER_BEHIND',
    errorClass: 'SCHEMA',
    errorRef: null,
    managerDecision: null,
    referenceLabel: 'IN',
    createdAtDevice: '2026-11-20T01:03:00.000Z',
    ackedAt: null,
  },
  {
    id: 'cmd-5',
    type: 'OpenShift',
    deviceSeq: 5,
    status: 'DISMISSED',
    schemaHeld: false,
    schemaHoldCode: null,
    attempts: 1,
    nextRetryAt: null,
    errorCode: 'VALIDATION_FAILED',
    errorClass: 'STRUCTURAL',
    errorRef: 'ref-5',
    managerDecision: 'DISMISSED',
    referenceLabel: 'shift-5',
    createdAtDevice: '2026-11-20T01:04:00.000Z',
    ackedAt: null,
  },
  {
    id: 'cmd-6',
    type: 'CloseShift',
    deviceSeq: 6,
    status: 'ACKED',
    schemaHeld: false,
    schemaHoldCode: null,
    attempts: 1,
    nextRetryAt: null,
    errorCode: null,
    errorClass: null,
    errorRef: null,
    managerDecision: 'ACCEPTED_MANUAL',
    referenceLabel: 'shift-6',
    createdAtDevice: '2026-11-20T01:05:00.000Z',
    ackedAt: '2026-11-20T02:00:00.000Z',
  },
]

describe('SCR-P14 QueueView, UpdateDialog, and ServerBehindBanner', () => {
  it('renders all queue & attention statuses with zero axe violations and exposes no raw payloads', async () => {
    const user = userEvent.setup()
    const onSyncNow = vi.fn()
    const onExportPending = vi.fn()
    const onSearchChange = vi.fn()

    const { container } = render(
      <QueueView
        items={SAMPLE_ITEMS}
        lastSuccessAt="2026-11-20T05:00:00.000Z"
        searchQuery=""
        onSearchChange={onSearchChange}
        onSyncNow={onSyncNow}
        onExportPending={onExportPending}
      />,
    )

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])

    expect(screen.getByText(/Needs Attention \(1\)/)).toBeTruthy()
    expect(screen.getByText('RETURN_EXCEEDS_QTY#att-ref-3')).toBeTruthy()
    expect(screen.getByText(/Waiting for server update \(SERVER_BEHIND\)/)).toBeTruthy()
    expect(screen.getByText('Dismissed by manager')).toBeTruthy()
    expect(screen.getByText('Manually accepted by manager')).toBeTruthy()
    expect(screen.getAllByText('Cashiers can keep working normally.').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /Try Sync Now/i }))
    expect(onSyncNow).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /Export Pending/i }))
    expect(onExportPending).toHaveBeenCalledTimes(1)

    await user.type(screen.getByPlaceholderText(/Search invoice/i), 'OUT01')
    expect(onSearchChange).toHaveBeenCalled()
  }, 15_000)

  it('renders UpdateDialog (soft with Later vs hard without Later) and ServerBehindBanner cleanly', async () => {
    const onReloadNow = vi.fn()
    const onSnooze = vi.fn()

    const { container, rerender } = render(
      <>
        <ServerBehindBanner />
        <UpdateDialog
          open
          mandatory={false}
          canSnooze
          onReloadNow={onReloadNow}
          onSnooze={onSnooze}
        />
      </>,
    )

    const axeSoft = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeSoft.violations).toEqual([])
    expect(screen.getByRole('button', { name: 'Later' })).toBeTruthy()
    expect(screen.getByTestId('server-behind-banner')).toBeTruthy()

    rerender(
      <UpdateDialog
        open
        mandatory
        canSnooze={false}
        onReloadNow={onReloadNow}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Update Now' })).toBeTruthy()
  }, 15_000)
})
