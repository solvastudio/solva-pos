import { describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { cashVariance } from '~/lib/sales-calc'
import type {
  CashMovementRecord,
  CreditNoteRefundRecord,
  SalePaymentRecord,
  SaleRecord,
} from '../db/types'
import { computeLocalShiftRecap } from './local-shift-recap'

const baseSale = (id: string, status: 'PAID' | 'VOID'): SaleRecord => ({
  id,
  tenant_id: 't1',
  outlet_id: 'o1',
  register_id: 'r1',
  device_id: 'd1',
  shift_id: 'sh1',
  status,
  created_by: 'u1',
  created_at_device: '2026-11-20T01:00:00.000Z',
  clock_offset_ms: 0,
  occurred_at: '2026-11-20T01:00:00.000Z',
  business_date: '2026-11-20',
  invoice_no: `INV-${id}`,
  invoice_prefix: 'OUT01-POS01',
  invoice_period: '1126',
  invoice_seq: 1,
  legal_entity_id: 'le1',
  legal_entity_npwp: null,
  legal_entity_is_pkp: false,
  price_tax_mode: 'EXCLUSIVE',
  tax_profile: 'NONE',
  tax_rate: '0',
  tax_rate_id: null,
  service_charge_rate: '0',
  service_charge_taxable: true,
  cash_rounding_unit: 100,
  receipt_locale: 'id-ID',
  currency: 'IDR',
  gross_total: 0,
  line_discount_total: 0,
  bill_discount_type: null,
  bill_discount_pct: null,
  bill_discount_input: null,
  bill_discount_total: 0,
  discount_approved_by: null,
  net_subtotal: 0,
  service_charge: 0,
  tax_base: 0,
  tax_amount: 0,
  dpp: 0,
  grand_total: 0,
  rounding: 0,
  total_due: 0,
  customer_name: null,
  customer_phone: null,
  catalog_cursor: null,
  bill_id: null,
  bill_ref: null,
  sync_status: 'PENDING',
  synced_at: null,
  server_result: null,
  print_state: 'QUEUED',
})

describe('pos/domain/local-shift-recap (V-21)', () => {
  it('reproduces V-21 expected cash (1,782,100) and variance (-2,100) while excluding VOID & separating non-cash', () => {
    const sales: SaleRecord[] = [
      baseSale('s1', 'PAID'),
      baseSale('s2', 'VOID'),
    ]
    const salePayments: SalePaymentRecord[] = [
      {
        id: 'p1',
        sale_id: 's1',
        shift_id: 'sh1',
        seq: 1,
        method_id: 'm1',
        method_code: 'CASH',
        method_name: 'Tunai',
        method_kind: 'CASH',
        amount_applied: 1_250_000,
        cash_tendered: 1_250_000,
        change_given: 0,
        reference: null,
        is_rounding_settler: true,
      },
      {
        id: 'p2',
        sale_id: 's1',
        shift_id: 'sh1',
        seq: 2,
        method_id: 'm2',
        method_code: 'QRIS',
        method_name: 'QRIS',
        method_kind: 'NON_CASH',
        amount_applied: 300_000,
        cash_tendered: null,
        change_given: null,
        reference: null,
        is_rounding_settler: false,
      },
      {
        id: 'p3',
        sale_id: 's2',
        shift_id: 'sh1',
        seq: 1,
        method_id: 'm1',
        method_code: 'CASH',
        method_name: 'Tunai',
        method_kind: 'CASH',
        amount_applied: 999_000,
        cash_tendered: 999_000,
        change_given: 0,
        reference: null,
        is_rounding_settler: true,
      },
    ]
    const cashMovements: CashMovementRecord[] = [
      {
        id: 'cm1',
        tenant_id: 't1',
        outlet_id: 'o1',
        register_id: 'r1',
        device_id: 'd1',
        shift_id: 'sh1',
        created_by: 'u1',
        created_at_device: '2026-11-20T02:00:00.000Z',
        clock_offset_ms: 0,
        occurred_at: '2026-11-20T02:00:00.000Z',
        business_date: '2026-11-20',
        direction: 'IN',
        amount: 200_000,
        reason_code: 'FLOAT_TOPUP',
        reason_text: 'Tambah kasir',
        sync_status: 'PENDING',
      },
      {
        id: 'cm2',
        tenant_id: 't1',
        outlet_id: 'o1',
        register_id: 'r1',
        device_id: 'd1',
        shift_id: 'sh1',
        created_by: 'u1',
        created_at_device: '2026-11-20T03:00:00.000Z',
        clock_offset_ms: 0,
        occurred_at: '2026-11-20T03:00:00.000Z',
        business_date: '2026-11-20',
        direction: 'OUT',
        amount: 150_000,
        reason_code: 'PETTY_CASH',
        reason_text: 'Beli es batu',
        sync_status: 'PENDING',
      },
    ]
    const creditNoteRefunds: CreditNoteRefundRecord[] = [
      {
        id: 'cnr1',
        credit_note_id: 'cn1',
        shift_id: 'sh1',
        seq: 1,
        method_id: 'm1',
        method_code: 'CASH',
        method_name: 'Tunai',
        method_kind: 'CASH',
        amount_applied: 17_900,
        reference: null,
      },
    ]

    const recap = computeLocalShiftRecap({
      shift: { id: 'sh1', opening_cash: 500_000 },
      sales,
      salePayments,
      cashMovements,
      creditNoteRefunds,
    })

    expect(recap.expectedCash).toBe(1_782_100)
    expect(cashVariance(toMoney(1_780_000), recap.expectedCash)).toBe(-2_100)
    expect(recap.paidSaleCount).toBe(1)
    expect(recap.voidSaleCount).toBe(1)
    expect(recap.nonCashTotal).toBe(300_000)
  })
})
