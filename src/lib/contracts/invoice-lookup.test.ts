import { describe, expect, it } from 'vitest'
import { InvoiceLookupResponseSchema } from './invoice-lookup'

describe('contracts/invoice-lookup', () => {
  it('validates canonical invoice lookup payload and rejects invalid status', () => {
    const valid = InvoiceLookupResponseSchema.parse({
      sale: {
        id: '0192a000-0000-7000-8000-000000000001',
        outlet_id: '0192a000-0000-7000-8000-000000000002',
        register_id: '0192a000-0000-7000-8000-000000000003',
        invoice_no: 'OUT01-POS02-1126-000001',
        business_date: '2026-11-20',
        status: 'PAID',
        price_tax_mode: 'EXCLUSIVE',
        cash_rounding_unit: 100,
        receipt_locale: 'id-ID',
        grand_total: 112_476,
        payments: [
          {
            method_id: '0192a000-0000-7000-8000-000000000004',
            method_code: 'CASH',
            method_name: 'Tunai',
            method_kind: 'CASH',
            amount_applied: 112_500,
          },
        ],
      },
      lines: [
        {
          id: '0192a000-0000-7000-8000-000000000005',
          line_no: 1,
          line_kind: 'ITEM',
          sku_id: '0192a000-0000-7000-8000-000000000006',
          uom_id: '0192a000-0000-7000-8000-000000000007',
          item_name: 'Susu UHT 1L',
          uom_code: 'pcs',
          qty: '3',
          conversion_factor: '1',
          unit_price: 17_900,
          line_net: 48_330,
          bill_discount_alloc: 0,
          service_alloc: 0,
          tax_alloc: 5_316,
          disposition_default: 'KEMBALI_STOK',
          returned_so_far: { qty: '1', net: 16_110, sc: 0, tax: 1_772 },
        },
      ],
    })
    expect(valid.sale.invoice_no).toBe('OUT01-POS02-1126-000001')

    expect(() =>
      InvoiceLookupResponseSchema.parse({
        ...valid,
        sale: { ...valid.sale, status: 'UNKNOWN' },
      }),
    ).toThrow()
  })
})
