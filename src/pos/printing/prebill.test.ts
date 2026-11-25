import { describe, expect, it } from 'vitest'
import { computeBillTotals } from '../domain/bill-totals'
import { encodeEscPos } from './escpos/encoder'
import { renderReceiptHtmlString } from './html-print/encoder'
import { renderReceiptDocText } from './layout'
import { buildPrebillDoc } from './prebill'
import { findPrinterProfile } from './printer-profiles'

describe('pos/printing/prebill', () => {
  it('renders a PRA-BILL document without invoice_no via both text, ESC/POS, and HTML encoders', () => {
    const items = [
      {
        item_name: 'Nasi Goreng',
        qty: '2',
        unit_price: 37000,
        taxable: true,
        discount_type: null,
        discount_pct: null,
        discount_input: null,
        status: 'ACTIVE' as const,
        modifiers: [{ name: 'Extra Sambal', price_delta: 2000, qty: 1 }],
      },
    ]
    const bill = {
      bill_discount_type: null,
      bill_discount_pct: null,
      bill_discount_input: null,
    }
    const totals = computeBillTotals({
      bill,
      items,
      cashRoundingUnit: 100,
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PB1',
        taxRate: '10',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      },
    })

    const doc = buildPrebillDoc({
      billRef: 'M05-0003',
      tableName: 'M05 — Meja 5',
      occurredAt: '2026-11-24T12:00:00.000Z',
      staffName: 'Rina',
      customerName: 'Tamu A',
      items,
      bill,
      totals,
      priceTaxMode: 'EXCLUSIVE',
      taxProfile: 'PB1',
      taxRate: '10',
      outlet: { name: 'Warung Solva', address: 'Jl. Merdeka 1', phone: null, timezone: 'Asia/Jakarta' },
      receiptSetting: null,
      locale: 'id-ID',
    })

    const text = renderReceiptDocText(doc, 32)
    expect(text).toContain('PRA-BILL')
    expect(text).toContain('M05-0003')
    expect(text).toContain('Extra Sambal')
    expect(text).not.toMatch(/OUT01-|INVOICE|CAS1-/)

    const bytes = encodeEscPos(doc, findPrinterProfile('escpos-58'))
    expect(bytes.length).toBeGreaterThan(20)

    const html = renderReceiptHtmlString(doc, 58)
    expect(html).toContain('PRA-BILL')
    expect(html).toContain('M05-0003')
  })
})
