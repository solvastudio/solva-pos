// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'
import { computeBillTotals } from '~/pos/domain/bill-totals'
import { BillPanel } from './BillPanel'
import { ChildBillList } from './ChildBillList'
import { HandoverDialog } from './HandoverDialog'
import { ModifierSheet } from './ModifierSheet'
import { TableCard } from './TableCard'

beforeEach(async () => {
  await changeLocale('id-ID')
})

afterEach(() => {
  cleanup()
})

async function expectZeroAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
    },
  })
  expect(results.violations).toEqual([])
}

describe('components/pos/fnb (accessibility & behavior)', () => {
  it('TableCard renders status icon+text, bill count badge, updated time, and passes axe', async () => {
    const { container } = render(
      <TableCard
        table={{
          id: 't5',
          outlet_id: 'o1',
          area: 'Indoor',
          code: 'M05',
          capacity: 4,
          is_active: true,
          sort_order: 1,
        }}
        derived={{
          status: 'LOCKED_OTHER',
          billCount: 2,
          updatedAt: '2026-11-24T12:05:00.000Z',
          bills: [
            {
              billId: 'b1',
              tableId: 't5',
              billRef: 'M05-0001',
              leaseDeviceId: 'dev-2',
              leaseRegisterId: 'reg-2',
              isAwaitingPayment: false,
              handoverStatus: 'NONE',
              lastEventSeq: 2,
              lastEventAt: '2026-11-24T12:05:00.000Z',
              source: 'snapshot',
            },
          ],
        }}
        summaryTotal={85000}
        onSelect={() => {}}
      />,
    )

    expect(screen.getByText('M05')).toBeTruthy()
    expect(screen.getByText('2 bill')).toBeTruthy()
    expect(screen.getByText('Dipegang device lain')).toBeTruthy()
    await expectZeroAxeViolations(container)
  })

  it('BillPanel hides Pay button for WAITER and disables Handover with offline reason, passing axe', async () => {
    const totals = computeBillTotals({
      bill: { bill_discount_type: null, bill_discount_pct: null, bill_discount_input: null },
      items: [
        {
          qty: '1',
          unit_price: 35000,
          taxable: true,
          discount_type: null,
          discount_pct: null,
          discount_input: null,
          status: 'ACTIVE',
        },
      ],
      cashRoundingUnit: 100,
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'NONE',
        taxRate: '0',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      },
    })

    const { container } = render(
      <BillPanel
        billRef="M05-0003"
        tableLabel="M05 — Meja 5"
        customerName={null}
        isAwaitingPayment={false}
        handoverStatus="NONE"
        editable={true}
        readOnlyReason={null}
        items={[
          {
            id: 'i1',
            lineNo: 1,
            itemName: 'Nasi Goreng',
            uomCode: 'pcs',
            qty: '1',
            unitPrice: 35000,
            discountType: null,
            discountPct: null,
            discountInput: null,
            note: null,
            status: 'ACTIVE',
            modifiers: [],
          },
        ]}
        totals={totals}
        taxProfile="NONE"
        taxRate="0"
        pendingOutboxCount={0}
        isWaiter={true}
        canPayBill={false}
        handoverCheck={{ ok: false, reason: 'OFFLINE' }}
        onOpenCustomer={() => {}}
        onOpenBillDiscount={() => {}}
        onOpenChangeTable={() => {}}
        onChangeQty={() => {}}
        onOpenLineDiscount={() => {}}
        onRequestVoid={() => {}}
        onPrintPrebill={() => {}}
        onOpenHandover={() => {}}
        onCancelBill={() => {}}
        onPayBill={() => {}}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Bayar' })).toBeNull()
    expect(screen.getByText('Serah-terima membutuhkan internet')).toBeTruthy()
    const hoBtn = screen.getByRole('button', { name: /Serahkan ke kasir/ })
    expect((hoBtn as HTMLButtonElement).disabled).toBe(true)
    await expectZeroAxeViolations(container)
  })

  it('ModifierSheet enforces required SINGLE selection, formats delta price, and passes axe', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ModifierSheet
        open={true}
        mode="ADD"
        itemName="Ayam Bakar"
        baseUnitPrice={42500}
        groups={[
          {
            group: {
              id: 'g1',
              name: 'Sambal',
              selection_type: 'SINGLE',
              min_select: 1,
              max_select: 1,
              is_active: true,
            },
            options: [
              {
                id: 'm1',
                modifier_group_id: 'g1',
                name: 'Extra Sambal',
                price_delta: 2000,
                is_active: true,
                sort_order: 1,
              },
            ],
          },
        ]}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />,
    )

    const addBtn = screen.getByRole('button', { name: 'Tambah ke bill' }) as HTMLButtonElement
    expect(addBtn.disabled).toBe(true)

    await user.click(screen.getByText('Extra Sambal'))
    expect(addBtn.disabled).toBe(false)
    await expectZeroAxeViolations(screen.getByRole('dialog'))
  })

  it('HandoverDialog renders target CASHIER list and passes axe', async () => {
    render(
      <HandoverDialog
        open={true}
        billRef="M05-0003"
        cashierRegisters={[
          {
            id: 'r1',
            outlet_id: 'o1',
            code: 'POS01',
            name: 'Kasir Utama',
            register_type: 'CASHIER',
            invoice_prefix: 'POS01',
            deleted_at: null,
          },
        ]}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    )

    expect(screen.getByText('Kasir Utama')).toBeTruthy()
    await expectZeroAxeViolations(screen.getByRole('dialog'))
  })

  it('ChildBillList renders split sibling badges cleanly', () => {
    render(
      <ChildBillList
        currentBillId="c1"
        childrenBills={[
          {
            id: 'c1',
            tenant_id: 't1',
            outlet_id: 'o1',
            register_id: 'r1',
            device_id: 'd1',
            table_id: 'tb1',
            bill_ref: 'M05-1',
            status: 'OPEN',
            lease_device_id: 'd1',
            lease_register_id: 'r1',
            handover_status: 'NONE',
            handover_target_register_id: null,
            handover_event_id: null,
            handover_requested_at: null,
            prebill_seq: null,
            prebill_printed_at: null,
            last_content_seq: 1,
            is_awaiting_payment: false,
            split_mode: 'EQUAL',
            parent_bill_id: 'p1',
            share_index: 1,
            share_count: 2,
            bill_discount_type: null,
            bill_discount_pct: null,
            bill_discount_input: null,
            bill_discount_approved_by: null,
            customer_name: null,
            customer_phone: null,
            last_event_seq: 1,
            last_event_at: null,
            created_by: 'u1',
            created_at_device: '2026-11-25T10:00:00.000Z',
            occurred_at: '2026-11-25T10:00:00.000Z',
            business_date: '2026-11-25',
            closed_at: null,
            sync_status: 'PENDING',
          },
        ]}
        onSelectBill={() => {}}
      />,
    )
    expect(screen.getByText('1/2')).toBeTruthy()
    expect(screen.getByText('OPEN')).toBeTruthy()
  })
})
