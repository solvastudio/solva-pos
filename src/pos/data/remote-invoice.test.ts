import { afterEach, describe, expect, it } from 'vitest'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { setMeta } from './meta.repo'
import { fetchRemoteInvoice } from './remote-invoice'

const T1 = '0192a000-0000-7000-8000-00000000a101'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

async function setupDb() {
  const db = await openTenantDb(T1)
  await setMeta(db, 'device', {
    device_id: '0192a000-0000-7000-8000-00000000a102',
    credential: 'secret-token',
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant_id: T1,
    slug: 'demo',
    register_id: '0192a000-0000-7000-8000-00000000a103',
    outlet_id: '0192a000-0000-7000-8000-00000000a104',
    register_type: 'CASHIER',
  })
  return db
}

describe('pos/data/remote-invoice', () => {
  it('returns offline on network failure, not_found on 404, and validated data on 200', async () => {
    const db = await setupDb()

    const offline = await fetchRemoteInvoice(db, 'OUT01-POS02-1126-000001', {
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    })
    expect(offline).toEqual({ kind: 'offline' })

    const notFound = await fetchRemoteInvoice(db, 'MISSING', {
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ code: 'NOT_FOUND' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    })
    expect(notFound).toEqual({ kind: 'not_found' })

    const payload = {
      sale: {
        id: '0192a000-0000-7000-8000-00000000a201',
        outlet_id: '0192a000-0000-7000-8000-00000000a104',
        register_id: '0192a000-0000-7000-8000-00000000a103',
        invoice_no: 'OUT01-POS02-1126-000001',
        business_date: '2026-11-20',
        status: 'PAID',
        price_tax_mode: 'EXCLUSIVE',
        cash_rounding_unit: 100,
        receipt_locale: 'id-ID',
        grand_total: 25_000,
        payments: [],
      },
      lines: [
        {
          id: '0192a000-0000-7000-8000-00000000a202',
          line_no: 1,
          line_kind: 'ITEM',
          sku_id: '0192a000-0000-7000-8000-00000000a203',
          uom_id: '0192a000-0000-7000-8000-00000000a204',
          item_name: 'Kopi',
          uom_code: 'pcs',
          qty: '1',
          conversion_factor: '1',
          unit_price: 25_000,
          line_net: 25_000,
          bill_discount_alloc: 0,
          service_alloc: 0,
          tax_alloc: 0,
          disposition_default: 'KEMBALI_STOK',
          returned_so_far: { qty: '0', net: 0, sc: 0, tax: 0 },
        },
      ],
    }

    const ok = await fetchRemoteInvoice(db, 'OUT01-POS02-1126-000001', {
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    })
    expect(ok.kind).toBe('ok')
  })
})
