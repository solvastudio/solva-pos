// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'
import type { PrintJobRecord, SalePaymentRecord, SaleRecord } from '~/pos/db/types'
import { SaleDone } from './SaleDone'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

const SALE: SaleRecord = {
  id: 'sale-1',
  tenant_id: 't1',
  outlet_id: 'o1',
  register_id: 'r1',
  device_id: 'd1',
  shift_id: 'sh1',
  status: 'PAID',
  created_by: 'u1',
  created_at_device: '2026-11-30T10:00:00.000Z',
  clock_offset_ms: 0,
  occurred_at: '2026-11-30T10:00:00.000Z',
  business_date: '2026-11-30',
  invoice_no: 'OUT01-POS02-1126-000001',
  invoice_prefix: 'OUT01-POS02',
  invoice_period: '1126',
  invoice_seq: 1,
  legal_entity_id: 'le1',
  legal_entity_npwp: null,
  legal_entity_is_pkp: false,
  price_tax_mode: 'EXCLUSIVE',
  tax_profile: 'PPN',
  tax_rate: '11',
  tax_rate_id: 'tr1',
  service_charge_rate: '0',
  service_charge_taxable: true,
  cash_rounding_unit: 100,
  receipt_locale: 'id-ID',
  currency: 'IDR',
  gross_total: 112_476,
  line_discount_total: 0,
  bill_discount_type: null,
  bill_discount_pct: null,
  bill_discount_input: null,
  bill_discount_total: 0,
  discount_approved_by: null,
  net_subtotal: 112_476,
  service_charge: 0,
  tax_base: 0,
  tax_amount: 0,
  dpp: 0,
  grand_total: 112_476,
  rounding: 24,
  total_due: 112_500,
  customer_name: null,
  customer_phone: null,
  catalog_cursor: null,
  bill_id: null,
  bill_ref: null,
  sync_status: 'PENDING',
  synced_at: null,
  server_result: null,
  print_state: 'QUEUED',
}

const PAYMENTS: SalePaymentRecord[] = [
  {
    id: 'p1',
    sale_id: 'sale-1',
    shift_id: 'sh1',
    seq: 1,
    method_id: 'm1',
    method_code: 'CASH',
    method_name: 'Tunai',
    method_kind: 'CASH',
    amount_applied: 112_500,
    cash_tendered: 150_000,
    change_given: 37_500,
    reference: null,
    is_rounding_settler: true,
  },
]

describe('SaleDone (SCR-P09)', () => {
  it('renders invoice number, large change, queued/failed print status, and triggers new sale cleanly with 0 axe violations', async () => {
    const user = userEvent.setup()
    const onNewSale = vi.fn()
    const queuedJob: PrintJobRecord = {
      id: 'pj1',
      kind: 'RECEIPT',
      status: 'QUEUED',
      entity_id: 'sale-1',
      receipt_locale: 'id-ID',
      attempts: 0,
      last_error: null,
      created_at: '2026-11-30T10:00:00.000Z',
      updated_at: '2026-11-30T10:00:00.000Z',
    }

    const { container, rerender } = render(
      <SaleDone sale={SALE} payments={PAYMENTS} printJob={queuedJob} onNewSale={onNewSale} />,
    )

    expect(screen.getByText('OUT01-POS02-1126-000001')).toBeTruthy()
    expect(screen.getByText(/37[.,]500/)).toBeTruthy()
    expect(screen.getByText('Print queued')).toBeTruthy()

    rerender(
      <SaleDone
        sale={SALE}
        payments={PAYMENTS}
        printJob={{ ...queuedJob, status: 'FAILED' }}
        onReprint={vi.fn()}
        onNewSale={onNewSale}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('could not be printed')

    await user.click(screen.getByRole('button', { name: /New Transaction/i }))
    expect(onNewSale).toHaveBeenCalledOnce()

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })
})
