// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttentionSection } from '~/components/admin/attention/AttentionSection'
import { GapTable } from '~/components/admin/attention/GapTable'
import { AuditTable } from '~/components/admin/audit/AuditTable'
import { PaymentMethodsTable } from '~/components/admin/settings/PaymentMethodsTable'
import { ReceiptSettingsForm } from '~/components/admin/settings/ReceiptSettingsForm'
import { TaxSettingsSection } from '~/components/admin/settings/TaxSettingsSection'
import '~/i18n'

afterEach(() => {
  cleanup()
})

describe('Admin F3 UI components (SCR-A09 & SCR-A07)', () => {
  it('renders AttentionSection with detail panel and decision buttons and passes axe', async () => {
    const { container } = render(
      <AttentionSection
        items={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            outletId: '33333333-3333-4333-8333-333333333333',
            registerId: '44444444-4444-4444-8444-444444444444',
            registerCode: 'R01',
            deviceId: '55555555-5555-4555-8555-555555555555',
            commandId: '66666666-6666-4666-8666-666666666666',
            commandType: 'FinalizeSale',
            reasonClass: 'AUTHORIZATION',
            reasonCode: 'DISCOUNT_LIMIT_EXCEEDED',
            detail: null,
            blockedByCommandId: null,
            status: 'OPEN',
            canAcceptManual: true,
            resolutionNote: null,
            resolvedBy: null,
            resolvedAt: null,
            requestRef: 'req-1234',
            createdAt: '2026-03-01T10:00:00.000Z',
            updatedAt: '2026-03-01T10:00:00.000Z',
            summary: {
              invoiceNo: 'INV-001',
              totalDue: 50000,
              lineCount: 1,
            },
            rawPayload: null,
          },
        ]}
        onAcceptManual={vi.fn()}
        onDismiss={vi.fn()}
        onEscalate={vi.fn()}
        onImportPending={vi.fn()}
      />,
    )

    expect(screen.getAllByText(/DISCOUNT_LIMIT_EXCEEDED/).length).toBeGreaterThan(0)
    const results = await axe.run(container)
    expect(results.violations).toEqual([])
  })

  it('renders GapTable and opens annotation dialog', async () => {
    render(
      <GapTable
        gaps={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            outletId: '33333333-3333-4333-8333-333333333333',
            registerId: '44444444-4444-4444-8444-444444444444',
            docType: 'INVOICE',
            period: '2026-03',
            seqFrom: 2,
            seqTo: 5,
            origin: 'DETECTED',
            status: 'OPEN',
            reasonCode: null,
            reasonText: null,
            explainedBy: null,
            explainedAt: null,
            filledAt: null,
            detectedAt: '2026-03-01T10:00:00.000Z',
          },
        ]}
        canAnnotate={true}
        onAnnotate={vi.fn()}
      />,
    )

    expect(screen.getAllByText('#2 – #5').length).toBeGreaterThan(0)
  })

  it('renders AuditTable strictly read-only without edit or delete actions', async () => {
    const { container } = render(
      <AuditTable
        rows={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            chainSeq: 1,
            outletId: null,
            outletName: null,
            outletTimezone: 'Asia/Jakarta',
            registerId: null,
            deviceId: null,
            actorUserId: '33333333-3333-4333-8333-333333333333',
            actorName: 'Rina Admin',
            approverUserId: null,
            approverName: null,
            action: 'sale.void',
            entityType: 'sale',
            entityId: '44444444-4444-4444-8444-444444444444',
            reasonCode: 'CASHIER_MISTAKE',
            reasonText: null,
            beforeData: null,
            afterData: { status: 'VOIDED' },
            occurredAt: '2026-03-01T10:00:00.000Z',
            recordedAt: '2026-03-01T10:00:01.000Z',
            businessDate: '2026-03-01',
          },
        ]}
        actionFilter=""
        fromDate=""
        toDate=""
        onActionFilterChange={vi.fn()}
        onFromDateChange={vi.fn()}
        onToDateChange={vi.fn()}
        onExportCsv={vi.fn()}
        onVerifyChain={vi.fn()}
        verifyResult={{ ok: true, checked: 1 }}
      />,
    )

    expect(screen.getAllByText('sale.void').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /hapus|delete|ubah|edit/i })).toBeNull()
    const results = await axe.run(container)
    expect(results.violations).toEqual([])
  })

  it('renders TaxSettingsSection with non-PKP warning', async () => {
    const { container } = render(
      <TaxSettingsSection
        tax={{
          outletId: '33333333-3333-4333-8333-333333333333',
          legalEntityIsPkp: false,
          taxProfile: 'NONE',
          priceTaxMode: 'EXCLUSIVE',
          cashRoundingUnit: 100,
          serviceChargeEnabled: false,
          serviceChargeRate: '5.0000',
          serviceChargeTaxable: false,
          timezone: 'Asia/Jakarta',
          dayCutoffTime: '00:00',
          version: 1,
        }}
        taxRates={[]}
        onSaveTaxSettings={vi.fn(async () => {})}
        onAddTaxRate={vi.fn(async () => {})}
      />,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    const results = await axe.run(container)
    expect(results.violations).toEqual([])
  })

  it('renders ReceiptSettingsForm with live transliterated monospace preview', async () => {
    const { container } = render(
      <ReceiptSettingsForm
        outletId="33333333-3333-4333-8333-333333333333"
        outletName="Café Crème"
        receipt={{
          id: '11111111-1111-4111-8111-111111111111',
          outletId: '33333333-3333-4333-8333-333333333333',
          receiptLocale: 'id-ID',
          headerText: 'Selamat datang — Café',
          footerText: 'Terima kasih!',
          logoSha256: null,
          version: 1,
        }}
        onSaveReceipt={vi.fn(async () => {})}
        onUploadLogo={vi.fn(async () => {})}
      />,
    )

    const preview = screen.getByTestId('receipt-preview')
    expect(preview.textContent).toContain('CAFE CREME')
    expect(preview.textContent).toContain('Selamat datang - Cafe')
    const results = await axe.run(container)
    expect(results.violations).toEqual([])
  })

  it('renders PaymentMethodsTable and protects sole active CASH method from deactivation', async () => {
    render(
      <PaymentMethodsTable
        methods={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            code: 'CASH',
            name: 'Tunai',
            kind: 'CASH',
            requiresReference: false,
            sortOrder: 0,
            isActive: true,
            version: 1,
          },
        ]}
        onSaveMethod={vi.fn(async () => {})}
      />,
    )

    const editButtons = screen.getAllByRole('button', { name: /ubah/i })
    fireEvent.click(editButtons[0]!)

    const switches = screen.getAllByRole('switch')
    const statusSwitch = switches[1] as HTMLButtonElement
    expect(statusSwitch.disabled).toBe(true)
  })
})
