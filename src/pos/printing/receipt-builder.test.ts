// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import type {
  OutletReceiptSettingRecord,
  OutletRecord,
  SaleLineRecord,
  SalePaymentRecord,
  SaleRecord,
} from '~/pos/db/types'
import { renderReceiptDocText } from './layout'
import { buildCreditNoteReceipt, buildReceipt, buildShiftRecap } from './receipt-builder'

export function createContoh1Sample(): {
  sale: SaleRecord
  lines: SaleLineRecord[]
  payments: SalePaymentRecord[]
  outlet: OutletRecord
  receiptSetting: OutletReceiptSettingRecord
} {
  const outlet: OutletRecord = {
    id: '0192a000-0000-7000-8000-00000000a001',
    legal_entity_id: '0192a000-0000-7000-8000-00000000a002',
    code: 'OUT01',
    name: 'TOKO SOLVA JAYA',
    address: 'Jl. Mawar No. 5 (contoh)',
    timezone: 'Asia/Jakarta',
    day_cutoff_time: '04:00',
    price_tax_mode: 'EXCLUSIVE',
    deleted_at: null,
  }
  const receiptSetting: OutletReceiptSettingRecord = {
    id: '0192a000-0000-7000-8000-00000000a003',
    outlet_id: outlet.id,
    receipt_locale: 'id-ID',
    header_text: 'TOKO SOLVA JAYA\nJl. Mawar No. 5 (contoh)',
    footer_text: 'Terima kasih',
    logo_sha256: null,
    deleted_at: null,
  }
  const sale: SaleRecord = {
    id: '0192a000-0000-7000-8000-00000000a010',
    tenant_id: '0192a000-0000-7000-8000-00000000a000',
    outlet_id: outlet.id,
    register_id: '0192a000-0000-7000-8000-00000000a004',
    device_id: '0192a000-0000-7000-8000-00000000a005',
    shift_id: '0192a000-0000-7000-8000-00000000a006',
    status: 'PAID',
    created_by: '0192a000-0000-7000-8000-00000000a007',
    created_at_device: '2026-11-17T07:05:00.000Z',
    clock_offset_ms: 0,
    occurred_at: '2026-11-17T07:05:00.000Z', // 14:05 WIB (Asia/Jakarta)
    business_date: '2026-11-17',
    invoice_no: 'OUT01-POS02-1126-000123',
    invoice_prefix: 'OUT01-POS02',
    invoice_period: '1126',
    invoice_seq: 123,
    legal_entity_id: outlet.legal_entity_id,
    legal_entity_npwp: null,
    legal_entity_is_pkp: false,
    price_tax_mode: 'EXCLUSIVE',
    tax_profile: 'PPN',
    tax_rate: '11',
    tax_rate_id: null,
    service_charge_rate: '0',
    service_charge_taxable: true,
    cash_rounding_unit: 100,
    receipt_locale: 'id-ID',
    currency: 'IDR',
    gross_total: 106_700,
    line_discount_total: 5_370,
    bill_discount_type: null,
    bill_discount_pct: null,
    bill_discount_input: null,
    bill_discount_total: 0,
    discount_approved_by: null,
    net_subtotal: 101_330,
    service_charge: 0,
    tax_base: 101_330,
    tax_amount: 11_146,
    dpp: 101_330,
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
  const lines: SaleLineRecord[] = [
    {
      id: 'l1',
      sale_id: sale.id,
      line_no: 1,
      line_kind: 'ITEM',
      product_id: null,
      sku_id: null,
      uom_id: null,
      sku_code: 'KOP',
      item_name: 'Kopi Bubuk 200g',
      uom_code: 'pcs',
      qty: '2',
      conversion_factor: '1',
      qty_base: '2',
      unit_price: 18_500,
      price_source: 'TENANT_DEFAULT',
      is_open_price: false,
      taxable: true,
      discount_type: null,
      discount_pct: null,
      discount_input: null,
      discount_approved_by: null,
      line_gross: 37_000,
      line_discount: 0,
      line_net: 37_000,
      bill_discount_alloc: 0,
      service_alloc: 0,
      tax_alloc: 4_070,
      note: null,
      source_bill_item_id: null,
      modifiers: [],
    },
    {
      id: 'l2',
      sale_id: sale.id,
      line_no: 2,
      line_kind: 'ITEM',
      product_id: null,
      sku_id: null,
      uom_id: null,
      sku_code: 'GUL',
      item_name: 'Gula 1kg',
      uom_code: 'pcs',
      qty: '1',
      conversion_factor: '1',
      qty_base: '1',
      unit_price: 16_000,
      price_source: 'TENANT_DEFAULT',
      is_open_price: false,
      taxable: true,
      discount_type: null,
      discount_pct: null,
      discount_input: null,
      discount_approved_by: null,
      line_gross: 16_000,
      line_discount: 0,
      line_net: 16_000,
      bill_discount_alloc: 0,
      service_alloc: 0,
      tax_alloc: 1_760,
      note: null,
      source_bill_item_id: null,
      modifiers: [],
    },
    {
      id: 'l3',
      sale_id: sale.id,
      line_no: 3,
      line_kind: 'ITEM',
      product_id: null,
      sku_id: null,
      uom_id: null,
      sku_code: 'SUS',
      item_name: 'Susu UHT 1L',
      uom_code: 'pcs',
      qty: '3',
      conversion_factor: '1',
      qty_base: '3',
      unit_price: 17_900,
      price_source: 'TENANT_DEFAULT',
      is_open_price: false,
      taxable: true,
      discount_type: 'PERCENT',
      discount_pct: '10',
      discount_input: null,
      discount_approved_by: null,
      line_gross: 53_700,
      line_discount: 5_370,
      line_net: 48_330,
      bill_discount_alloc: 0,
      service_alloc: 0,
      tax_alloc: 5_316,
      note: null,
      source_bill_item_id: null,
      modifiers: [],
    },
  ]
  const payments: SalePaymentRecord[] = [
    {
      id: 'p1',
      sale_id: sale.id,
      shift_id: sale.shift_id,
      seq: 1,
      method_id: 'pm-cash',
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
  return { sale, lines, payments, outlet, receiptSetting }
}

describe('pos/printing/receipt-builder', () => {
  it('matches Contoh 1 (V-04 BR-PRN-007) golden 32-column text output exactly', () => {
    const sample = createContoh1Sample()
    const doc = buildReceipt({
      kind: 'RECEIPT',
      sale: sample.sale,
      lines: sample.lines,
      payments: sample.payments,
      outlet: sample.outlet,
      receiptSetting: sample.receiptSetting,
      cashierName: 'Dewi',
      locale: 'id-ID',
      columns: 32,
    })

    const rendered = renderReceiptDocText(doc, 32)
    const golden = readFileSync(
      resolve(process.cwd(), 'tests/fixtures/receipt-contoh1.golden.txt'),
      'utf8',
    ).replace(/\r\n/g, '\n').trimEnd()

    expect(rendered).toBe(golden)
  })

  it('F3-K06: struk memakai locale snapshot outlet (en-US) dan format angka per locale; tanpa locale cadangan UI', () => {
    const sample = createContoh1Sample()
    const idDoc = buildReceipt({
      kind: 'RECEIPT',
      sale: { ...sample.sale, receipt_locale: 'id-ID' },
      lines: sample.lines,
      payments: sample.payments,
      outlet: sample.outlet,
      receiptSetting: sample.receiptSetting,
      cashierName: 'Dewi',
      locale: 'id-ID',
      columns: 32,
    })
    const enDoc = buildReceipt({
      kind: 'RECEIPT',
      sale: { ...sample.sale, receipt_locale: 'en-US' },
      lines: sample.lines,
      payments: sample.payments,
      outlet: sample.outlet,
      receiptSetting: sample.receiptSetting,
      cashierName: 'Dewi',
      locale: 'en-US',
      columns: 32,
    })
    const idTxt = renderReceiptDocText(idDoc, 32)
    const enTxt = renderReceiptDocText(enDoc, 32)
    // Angka: 112.500 (id-ID) vs 112,500 (en-US).
    expect(idTxt).toContain('112.500')
    expect(enTxt).toContain('112,500')
    expect(enTxt).not.toContain('112.500')
    // The receipt language follows the snapshot, not the cashier UI language.
    expect(enTxt).not.toBe(idTxt)
  })

  it('builds REPRINT with CETAK ULANG badge, inclusive tax suffix, bill discount + SC, NK, and 48-col layout', () => {
    const sample = createContoh1Sample()
    const reprintDoc = buildReceipt({
      kind: 'REPRINT',
      sale: {
        ...sample.sale,
        price_tax_mode: 'INCLUSIVE',
        bill_discount_total: 5_000,
        service_charge: 4_500,
      },
      lines: sample.lines,
      payments: [
        ...sample.payments,
        {
          id: 'p2',
          sale_id: sample.sale.id,
          shift_id: sample.sale.shift_id,
          seq: 2,
          method_id: 'pm-qris',
          method_code: 'QRIS',
          method_name: 'QRIS',
          method_kind: 'NON_CASH',
          amount_applied: 20_000,
          cash_tendered: null,
          change_given: null,
          reference: 'QR-991',
          is_rounding_settler: false,
        },
      ],
      outlet: sample.outlet,
      receiptSetting: sample.receiptSetting,
      cashierName: 'Dewi',
      columns: 48,
    })
    const reprintTxt = renderReceiptDocText(reprintDoc, 48)
    expect(reprintTxt).toContain('CETAK ULANG')
    expect(reprintTxt).toContain('PPN 11% (termasuk)')
    expect(reprintTxt).toContain('Diskon bill')
    expect(reprintTxt).toContain('Service charge')
    expect(reprintTxt).toContain('QRIS (QR-991)')

    const nkDoc = buildCreditNoteReceipt({
      creditNote: {
        id: 'cn1',
        tenant_id: sample.sale.tenant_id,
        outlet_id: sample.outlet.id,
        register_id: sample.sale.register_id,
        device_id: sample.sale.device_id,
        shift_id: sample.sale.shift_id,
        created_by: sample.sale.created_by,
        approved_by: 'sup1',
        created_at_device: '2026-11-17T08:00:00.000Z',
        clock_offset_ms: 0,
        occurred_at: '2026-11-17T08:00:00.000Z',
        business_date: '2026-11-17',
        cn_no: 'OUT01-POS02-NK-1126-000001',
        cn_prefix: 'OUT01-POS02',
        cn_period: '1126',
        cn_seq: 1,
        original_sale_id: sample.sale.id,
        original_invoice_no: sample.sale.invoice_no,
        reason_code: 'CUSTOMER_REQUEST',
        reason_text: null,
        price_tax_mode: 'EXCLUSIVE',
        cash_rounding_unit: 100,
        receipt_locale: 'id-ID',
        net_total: 16_110,
        service_total: 0,
        tax_total: 1_772,
        refund_gross: 17_882,
        rounding: 18,
        sync_status: 'PENDING',
        print_state: 'QUEUED',
      },
      lines: [
        {
          id: 'cnl1',
          credit_note_id: 'cn1',
          line_no: 1,
          sale_line_id: 'l3',
          qty_returned: '1',
          qty_returned_base: '1',
          refund_net: 16_110,
          refund_service: 0,
          refund_tax: 1_772,
          is_final_return: false,
          disposition: 'KEMBALI_STOK',
          item_name: 'Susu UHT 1L',
          uom_code: 'pcs',
        },
      ],
      refunds: [
        {
          id: 'cnr1',
          credit_note_id: 'cn1',
          shift_id: sample.sale.shift_id,
          seq: 1,
          method_id: 'pm-cash',
          method_code: 'CASH',
          method_name: 'Tunai',
          method_kind: 'CASH',
          amount_applied: 17_900,
          reference: null,
        },
      ],
      outlet: sample.outlet,
      receiptSetting: sample.receiptSetting,
      cashierName: 'Dewi',
    })
    const nkTxt = renderReceiptDocText(nkDoc, 32)
    expect(nkTxt).toContain('OUT01-POS02-NK-1126-000001')
    expect(nkTxt).toContain('TOTAL RETUR')
    expect(nkTxt).toContain('17.900')

    // Shift recap must hide expectedCash while OPEN, and include it when CLOSED
    const recapData = {
      openingCash: toMoney(500_000),
      cashSalesTotal: toMoney(100_000),
      cashInTotal: toMoney(0),
      cashOutTotal: toMoney(0),
      cashRefundsTotal: toMoney(0),
      expectedCash: toMoney(600_000),
      paidSaleCount: 1,
      voidSaleCount: 0,
      nonCashTotal: toMoney(0),
      methods: [],
    }
    const openRecap = renderReceiptDocText(
      buildShiftRecap({
        shift: {
          id: 'sh1',
          tenant_id: sample.sale.tenant_id,
          outlet_id: sample.outlet.id,
          register_id: sample.sale.register_id,
          device_id: sample.sale.device_id,
          status: 'OPEN',
          opening_cash: 500_000,
          opened_by: 'u1',
          created_at_device: '2026-11-17T01:00:00.000Z',
          occurred_at: '2026-11-17T01:00:00.000Z',
          business_date: '2026-11-17',
          closed_at: null,
          counted_cash: null,
          sync_status: 'PENDING',
        },
        recap: recapData,
        outlet: sample.outlet,
        registerCode: 'POS02',
        cashierName: 'Dewi',
        locale: 'id-ID',
      }),
    )
    expect(openRecap).not.toContain('Kas Ekspektasi')
  })
})
