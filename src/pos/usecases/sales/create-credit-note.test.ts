import { afterEach, describe, expect, it } from 'vitest'
import { parseCommandPayload } from '~/lib/contracts'
import { toMoney } from '~/lib/kernel'
import { setMeta } from '../../data/meta.repo'
import { getSaleWithDetails } from '../../data/sale.repo'
import { deleteTenantDbForTests, openTenantDb } from '../../db/solva-db'
import { addItem, createEmptyCart, setLineDiscount } from '../../domain/cart'
import { closeShift } from '../shift/close-shift'
import { openShift } from '../shift/open-shift'
import { createCreditNote, CreateCreditNoteError } from './create-credit-note'
import { finalizeSale } from './finalize-sale'

const T1 = '0192a000-0000-7000-8000-00000000a101'
const OUT = '0192a000-0000-7000-8000-00000000a102'
const REG = '0192a000-0000-7000-8000-00000000a103'
const DEV = '0192a000-0000-7000-8000-00000000a104'
const STAFF = '0192a000-0000-7000-8000-00000000a105'
const SUP = '0192a000-0000-7000-8000-00000000a106'
const LE = '0192a000-0000-7000-8000-00000000a107'
const TR = '0192a000-0000-7000-8000-00000000a108'
const PM_CASH = '0192a000-0000-7000-8000-00000000a109'
const UOM_PCS = '0192a000-0000-7000-8000-00000000a110'
const UOM_KG = '0192a000-0000-7000-8000-00000000a111'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

async function setupBase() {
  const db = await openTenantDb(T1)
  await setMeta(db, 'device', {
    device_id: DEV,
    credential: 'c',
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant_id: T1,
    slug: 'demo',
    register_id: REG,
    outlet_id: OUT,
    register_type: 'CASHIER',
  })
  await setMeta(db, 'clock', {
    offset_ms: 0,
    offset_at: '2026-11-20T00:00:00.000Z',
    max_seen_time: '2026-11-20T00:00:00.000Z',
  })
  await db.legal_entity.put({ id: LE, name: 'PT', npwp: null, is_pkp: false, deleted_at: null })
  await db.outlet.put({
    id: OUT,
    legal_entity_id: LE,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    day_cutoff_time: '04:00',
    price_tax_mode: 'EXCLUSIVE',
    tax_profile: 'PPN',
    cash_rounding_unit: 100,
    deleted_at: null,
  })
  await db.tax_rate_history.put({
    id: TR,
    tax_code: 'PPN',
    outlet_id: null,
    outlet_key: '*',
    effective_from: '2025-01-01',
    rate: '11.0000',
    deleted_at: null,
  })
  await db.register_invoice_prefix.put({
    id: 'p1',
    register_id: REG,
    effective_month: '2026-11-01',
    invoice_prefix: 'OUT01-POS02',
    deleted_at: null,
  })
  await db.uom.bulkPut([
    { id: UOM_PCS, code: 'pcs', name: 'Pcs', allow_fraction: false, deleted_at: null },
    { id: UOM_KG, code: 'kg', name: 'Kg', allow_fraction: true, deleted_at: null },
  ])
  return db
}

describe('pos/usecases/sales/create-credit-note (V-18, V-23, partial returns)', () => {
  it('computes V-18 (1 of 3 Susu -> 17,900 cash, NK-1126-000001), enforces remaining qty & 3-month window, and handles 3.333/3.333/3.334 decimal splits', async () => {
    const db = await setupBase()
    const saleNow = () => Date.parse('2026-11-20T08:00:00.000Z')
    await openShift(db, { openingCash: 500_000, staffId: STAFF }, { nowMs: saleNow })

    let cart = createEmptyCart({
      finalizeId: '0192a000-0000-7000-8000-00000000a201',
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      },
      cashRoundingUnit: 100,
      taxRateId: TR,
      createdAt: '2026-11-20T08:00:00.000Z',
      shiftId: null,
    })

    // Line 1: Susu UHT 1L x3 @ 17,900 with 10% line discount (V-04/V-18)
    const rSusu = addItem(
      cart,
      {
        skuId: '0192a000-0000-7000-8000-00000000a301',
        productId: '0192a000-0000-7000-8000-00000000a302',
        uomId: UOM_PCS,
        skuCode: 'SUS',
        itemName: 'Susu UHT 1L',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: true,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(17_900), source: 'OUTLET' },
      },
      { newId: '0192a000-0000-7000-8000-00000000a303', qtyInput: '3' },
    )
    if (!rSusu.ok) throw new Error('expected ok')
    const dSusu = setLineDiscount(rSusu.cart, rSusu.touchedLineId, { type: 'PERCENT', pct: '10' })
    if (!dSusu.ok) throw new Error('expected ok')
    cart = dSusu.cart

    // Line 2: Beras 10 kg @ 15,000
    const rBeras = addItem(
      cart,
      {
        skuId: '0192a000-0000-7000-8000-00000000a401',
        productId: '0192a000-0000-7000-8000-00000000a402',
        uomId: UOM_KG,
        skuCode: 'BRS',
        itemName: 'Beras',
        uomCode: 'kg',
        conversionFactor: '1',
        taxable: false,
        allowFraction: true,
        price: { kind: 'PRICE', price: toMoney(15_000), source: 'DEFAULT' },
      },
      { newId: '0192a000-0000-7000-8000-00000000a403', qtyInput: '10' },
    )
    if (!rBeras.ok) throw new Error('expected ok')
    cart = rBeras.cart

    const fin = await finalizeSale(
      db,
      {
        cart,
        payments: [
          {
            methodId: PM_CASH,
            methodCode: 'CASH',
            methodName: 'Tunai',
            kind: 'CASH',
            amount: toMoney(300_000),
          },
        ],
        staffId: STAFF,
      },
      { nowMs: saleNow },
    )

    const details = await getSaleWithDetails(db, fin.saleId)
    const susuLineId = details!.lines[0]!.id
    const berasLineId = details!.lines[1]!.id

    // V-18: Return 1 of 3 Susu -> net 16,110 + tax 1,772 = 17,882 -> cash 17,900
    const nk1 = await createCreditNote(
      db,
      {
        source: { kind: 'LOCAL', saleId: fin.saleId },
        lines: [{ saleLineId: susuLineId, qtyReturn: '1', disposition: 'KEMBALI_STOK' }],
        reasonCode: 'CUSTOMER_REQUEST',
        reasonText: 'Wrong flavor',
        staffId: STAFF,
        approverId: SUP,
        refundMethod: { id: PM_CASH, code: 'CASH', name: 'Tunai', kind: 'CASH' },
      },
      { nowMs: saleNow },
    )

    expect(nk1.creditNote.cn_no).toBe('OUT01-POS02-NK-1126-000001')
    expect(nk1.creditNote.net_total).toBe(16_110)
    expect(nk1.creditNote.tax_total).toBe(1_772)
    expect(nk1.creditNote.refund_gross).toBe(17_882)
    expect(nk1.creditNote.rounding).toBe(18)
    expect(nk1.totalRefund).toBe(17_900)

    const cmds = await db.outbox_command.toArray()
    const cnCmd = cmds.find((c) => c.type === 'FinalizeCreditNote')
    expect(cnCmd!.depends_on).toEqual([fin.saleId])
    expect(() => parseCommandPayload('FinalizeCreditNote', 1, cnCmd!.payload)).not.toThrow()

    // Exceeds remaining Susu qty (3 - 1 = 2 remaining) -> rejected
    await expect(
      createCreditNote(
        db,
        {
          source: { kind: 'LOCAL', saleId: fin.saleId },
          lines: [{ saleLineId: susuLineId, qtyReturn: '2.5' }],
          reasonCode: 'CUSTOMER_REQUEST',
          staffId: STAFF,
          approverId: SUP,
          refundMethod: { id: PM_CASH, code: 'CASH', name: 'Tunai', kind: 'CASH' },
        },
        { nowMs: saleNow },
      ),
    ).rejects.toMatchObject({ code: 'EXCEEDS_REMAINING_QTY' } satisfies Partial<CreateCreditNoteError>)

    // Three sequential fractional returns on Beras 10 kg: 3.333 + 3.333 + 3.334
    for (const [idx, qty] of (['3.333', '3.333', '3.334'] as const).entries()) {
      const nkB = await createCreditNote(
        db,
        {
          source: { kind: 'LOCAL', saleId: fin.saleId },
          lines: [{ saleLineId: berasLineId, qtyReturn: qty }],
          reasonCode: 'DAMAGED',
          staffId: STAFF,
          approverId: SUP,
          refundMethod: { id: PM_CASH, code: 'CASH', name: 'Tunai', kind: 'CASH' },
        },
        { nowMs: saleNow },
      )
      expect(nkB.lines[0]!.is_final_return).toBe(idx === 2)
    }

    // Total refunded net across 3 Beras NK equals exact original line_net (150,000)
    const allCnLines = await db.credit_note_line.where('sale_line_id').equals(berasLineId).toArray()
    expect(allCnLines.reduce((acc, l) => acc + l.refund_net, 0)).toBe(150_000)

    // Outside 3-month return window -> rejected (2026-11-20 + 3 months = 2027-02-20; test 2027-02-22)
    await expect(
      createCreditNote(
        db,
        {
          source: { kind: 'LOCAL', saleId: fin.saleId },
          lines: [{ saleLineId: susuLineId, qtyReturn: '1' }],
          reasonCode: 'CUSTOMER_REQUEST',
          staffId: STAFF,
          approverId: SUP,
          refundMethod: { id: PM_CASH, code: 'CASH', name: 'Tunai', kind: 'CASH' },
        },
        { nowMs: () => Date.parse('2027-02-22T10:00:00.000Z') },
      ),
    ).rejects.toMatchObject({ code: 'OUTSIDE_RETURN_WINDOW' } satisfies Partial<CreateCreditNoteError>)

    // Cash refund without open shift -> rejected
    await closeShift(db, { countedCash: 500_000, staffId: STAFF }, { nowMs: saleNow })
    await expect(
      createCreditNote(
        db,
        {
          source: { kind: 'LOCAL', saleId: fin.saleId },
          lines: [{ saleLineId: susuLineId, qtyReturn: '1' }],
          reasonCode: 'CUSTOMER_REQUEST',
          staffId: STAFF,
          approverId: SUP,
          refundMethod: { id: PM_CASH, code: 'CASH', name: 'Tunai', kind: 'CASH' },
        },
        { nowMs: saleNow },
      ),
    ).rejects.toMatchObject({ code: 'SHIFT_REQUIRED' } satisfies Partial<CreateCreditNoteError>)
  })
})
