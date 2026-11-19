import { describe, expect, it } from 'vitest'
import {
  ATTENTION_REASON_CLASS,
  ATTENTION_STATUS,
  BILL_EVENT_TYPE,
  BILL_HANDOVER_STATUS,
  BILL_ITEM_STATUS,
  BILL_SPLIT_MODE,
  BILL_STATUS,
  CASH_MOVEMENT_DIRECTION,
  COMMAND_TYPE,
  DATA_FLAG_STATUS,
  DISCOUNT_TYPE,
  DOC_TYPE,
  ERROR_CLASS_CLIENT,
  FLAG_CODE,
  IDEMPOTENCY_STATUS,
  INVOICE_GAP_STATUS,
  ITEM_AVAILABILITY_STATUS,
  MEMBERSHIP_STATUS,
  OUTBOX_STATUS,
  PAYMENT_METHOD_KIND,
  PRICE_SOURCE,
  PRICE_TAX_MODE,
  PRODUCT_TYPE,
  REGISTER_TYPE,
  RETURN_DISPOSITION,
  SALE_LINE_KIND,
  SALE_STATUS,
  SHIFT_RECAP_STATUS,
  SHIFT_STATUS,
  STOCK_COST_BASIS,
  STOCK_MOVEMENT_KIND,
  TAX_CODE,
  TAX_PROFILE,
  TENANT_STATUS,
  TRANSFER_STATUS,
} from './enums'

describe('contracts/enums matches SCHEMA.md Appendix A & B', () => {
  it('matches all required enums verbatim against the schema document', () => {
    expect(TENANT_STATUS).toEqual(['ACTIVE', 'SUSPENDED', 'CLOSED'])
    expect(REGISTER_TYPE).toEqual(['CASHIER', 'WAITER'])
    expect(TAX_PROFILE).toEqual(['NONE', 'PPN', 'PB1'])
    expect(TAX_CODE).toEqual(['PPN', 'PB1'])
    expect(PRICE_TAX_MODE).toEqual(['INCLUSIVE', 'EXCLUSIVE'])
    expect(PAYMENT_METHOD_KIND).toEqual(['CASH', 'NON_CASH'])
    expect(PRODUCT_TYPE).toEqual(['RETAIL', 'MENU_FNB'])
    expect(ITEM_AVAILABILITY_STATUS).toEqual(['AVAILABLE', 'UNAVAILABLE'])
    expect(SALE_STATUS).toEqual(['PAID', 'VOID'])
    expect(SALE_LINE_KIND).toEqual(['ITEM', 'SHARE', 'STOCK_BASIS'])
    expect(PRICE_SOURCE).toEqual(['OUTLET', 'TENANT_DEFAULT', 'OPEN_PRICE'])
    expect(DISCOUNT_TYPE).toEqual(['PERCENT', 'NOMINAL'])
    expect(RETURN_DISPOSITION).toEqual(['KEMBALI_STOK', 'BUANG'])
    expect(SHIFT_STATUS).toEqual(['OPEN', 'CLOSED', 'FORCE_CLOSED'])
    expect(SHIFT_RECAP_STATUS).toEqual(['COMPLETE', 'INCOMPLETE'])
    expect(CASH_MOVEMENT_DIRECTION).toEqual(['IN', 'OUT'])
    expect(DOC_TYPE).toEqual(['INVOICE', 'CREDIT_NOTE'])
    expect(INVOICE_GAP_STATUS).toEqual(['OPEN', 'EXPLAINED', 'FILLED'])
    expect(TRANSFER_STATUS).toEqual(['DRAFT', 'SENT', 'RECEIVED', 'CANCELED'])
    expect(BILL_STATUS).toEqual(['OPEN', 'SPLIT', 'PAID', 'CANCELED', 'MERGED', 'CLOSED_BY_SPLIT'])
    expect(BILL_SPLIT_MODE).toEqual(['ITEM', 'QTY', 'EQUAL'])
    expect(BILL_HANDOVER_STATUS).toEqual(['NONE', 'PENDING'])
    expect(BILL_EVENT_TYPE).toHaveLength(15)
    expect(BILL_ITEM_STATUS).toEqual(['ACTIVE', 'VOIDED', 'MOVED'])
    expect(MEMBERSHIP_STATUS).toEqual(['PENDING', 'ACTIVE'])
    expect(COMMAND_TYPE).toEqual([
      'FinalizeSale',
      'VoidSale',
      'FinalizeCreditNote',
      'OpenShift',
      'RecordCashMovement',
      'CloseShift',
      'AppendBillEvents',
      'HandOverBill',
      'AcceptBill',
      'CancelBillHandover',
      'AppendAudit',
      'ReportPinState',
    ])
    expect(OUTBOX_STATUS).toEqual(['PENDING', 'SENDING', 'ACKED', 'NEEDS_ATTENTION'])
    expect(IDEMPOTENCY_STATUS).toEqual(['ACKED', 'ATTENTION', 'ACCEPTED_MANUAL', 'DISMISSED'])
    expect(ATTENTION_STATUS).toEqual(['OPEN', 'ACCEPTED', 'DISMISSED', 'ESCALATED'])
    expect(FLAG_CODE).toEqual([
      'HARGA_STALE',
      'ITEM_NONAKTIF',
      'ITEM_TIDAK_TERSEDIA',
      'TARIF_BERBEDA',
      'SELISIH_HITUNG',
      'NOMOR_KONFLIK',
      'STOK_MINUS',
      'TANPA_RESEP',
      'BILL_GANDA_MEJA',
      'SELISIH_TRANSFER',
    ])
    expect(ATTENTION_REASON_CLASS).toEqual(['STRUCTURAL', 'AUTHORIZATION'])
    expect(ERROR_CLASS_CLIENT).toEqual(['TRANSIENT', 'STRUCTURAL', 'AUTHORIZATION', 'SCHEMA'])
    expect(DATA_FLAG_STATUS).toEqual(['OPEN', 'ACKNOWLEDGED', 'RESOLVED'])
    expect(STOCK_MOVEMENT_KIND).toHaveLength(9)
    expect(STOCK_COST_BASIS).toEqual([
      'AVERAGE',
      'REFERENCE',
      'MIXED',
      'SNAPSHOT',
      'TRANSFER',
      'DECLARED',
    ])
  })
})
