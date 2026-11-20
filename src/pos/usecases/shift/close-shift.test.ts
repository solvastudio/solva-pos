import { afterEach, describe, expect, it } from 'vitest'
import { parseCommandPayload } from '~/lib/contracts'
import { toMoney } from '~/lib/kernel'
import { setMeta } from '../../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../../db/solva-db'
import { addItem, createEmptyCart, setLineDiscount } from '../../domain/cart'
import { createCreditNote } from '../sales/create-credit-note'
import { finalizeSale } from '../sales/finalize-sale'
import { closeShift, CloseShiftError } from './close-shift'
import { openShift } from './open-shift'
import { recordCashMovement } from './record-cash-movement'

const T1 = '0192a000-0000-7000-8000-00000000c101'
const OUT = '0192a000-0000-7000-8000-00000000c102'
const REG = '0192a000-0000-7000-8000-00000000c103'
const DEV = '0192a000-0000-7000-8000-00000000c104'
const STAFF = '0192a000-0000-7000-8000-00000000c105'
const SUP = '0192a000-0000-7000-8000-00000000c106'
const LE = '0192a000-0000-7000-8000-00000000c107'
const TR = '0192a000-0000-7000-8000-00000000c108'
const PM_CASH = '0192a000-0000-7000-8000-00000000c109'
const UOM_PCS = '0192a000-0000-7000-8000-00000000c110'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/usecases/shift/close-shift (V-21, blind count lock)', () => {
  it('computes expectedCash + variance (-2,100 on V-21 scenario), queues CloseShift + shift.variance audit, and locks count', async () => {
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
      tax_profile: 'NONE',
      cash_rounding_unit: 100,
      deleted_at: null,
    })
    await db.register_invoice_prefix.put({
      id: 'p1',
      register_id: REG,
      effective_month: '2026-11-01',
      invoice_prefix: 'OUT01-POS02',
      deleted_at: null,
    })
    await db.uom.put({ id: UOM_PCS, code: 'pcs', name: 'Pcs', allow_fraction: false, deleted_at: null })

    const now = () => Date.parse('2026-11-20T08:00:00.000Z')
    await expect(closeShift(db, { countedCash: 0, staffId: STAFF })).rejects.toMatchObject({
      code: 'SHIFT_NOT_OPEN',
    } satisfies Partial<CloseShiftError>)

    await openShift(db, { openingCash: 500_000, staffId: STAFF }, { nowMs: now })

    // Cash sales = 1,250,000 + Susu x3 (with tax/disc overridden below using 17,900 pcs non-tax -> let's use exact V-21 components via 1 sale 1,250,000 & 1 return 17,900)
    let cart = createEmptyCart({
      finalizeId: '0192a000-0000-7000-8000-00000000c201',
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'NONE',
        taxRate: '0',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      },
      cashRoundingUnit: 100,
      taxRateId: TR,
      createdAt: '2026-11-20T08:00:00.000Z',
      shiftId: null,
    })
    const rFirst = addItem(
      cart,
      {
        skuId: '0192a000-0000-7000-8000-00000000c301',
        productId: '0192a000-0000-7000-8000-00000000c302',
        uomId: UOM_PCS,
        skuCode: 'A1',
        itemName: 'Paket Besar',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: false,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(1_250_000), source: 'DEFAULT' },
      },
      { newId: '0192a000-0000-7000-8000-00000000c303' },
    )
    if (!rFirst.ok) throw new Error('expected ok')
    cart = rFirst.cart
    const rLine = addItem(
      cart,
      {
        skuId: '0192a000-0000-7000-8000-00000000c304',
        productId: '0192a000-0000-7000-8000-00000000c305',
        uomId: UOM_PCS,
        skuCode: 'R1',
        itemName: 'Item Retur',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: false,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(17_900), source: 'DEFAULT' },
      },
      { newId: '0192a000-0000-7000-8000-00000000c306' },
    )
    if (!rLine.ok) throw new Error('expected ok')
    cart = rLine.cart

    // Cash applied across sale = 1,250,000 + 17,900? To match V-21 exact (opening 500k + cashSales 1,250k + in 200k - out 150k - refund 17,900 = 1,782,100), pay 1,250,000 cash + 17,900 QRIS!
    const dLine = setLineDiscount(cart, rLine.touchedLineId, null)
    if (!dLine.ok) throw new Error('expected ok')
    cart = dLine.cart
    const sale = await finalizeSale(
      db,
      {
        cart,
        payments: [
          {
            methodId: '0192a000-0000-7000-8000-00000000c999',
            methodCode: 'QRIS',
            methodName: 'QRIS',
            kind: 'NON_CASH',
            amount: toMoney(17_900),
          },
          {
            methodId: PM_CASH,
            methodCode: 'CASH',
            methodName: 'Tunai',
            kind: 'CASH',
            amount: toMoney(1_250_000),
          },
        ],
        staffId: STAFF,
      },
      { nowMs: now },
    )

    await recordCashMovement(
      db,
      { direction: 'IN', amount: 200_000, reasonCode: 'TOPUP', reasonText: 'Float', staffId: STAFF },
      { nowMs: now },
    )
    await recordCashMovement(
      db,
      { direction: 'OUT', amount: 150_000, reasonCode: 'PETTY', reasonText: 'Supplies', staffId: STAFF },
      { nowMs: now },
    )
    await createCreditNote(
      db,
      {
        source: { kind: 'LOCAL', saleId: sale.saleId },
        lines: [{ saleLineId: (await db.sale_line.where('sale_id').equals(sale.saleId).sortBy('line_no'))[1]!.id, qtyReturn: '1' }],
        reasonCode: 'CUSTOMER_REQUEST',
        staffId: STAFF,
        approverId: SUP,
        refundMethod: { id: PM_CASH, code: 'CASH', name: 'Tunai', kind: 'CASH' },
      },
      { nowMs: now },
    )

    const closed = await closeShift(
      db,
      { countedCash: 1_780_000, staffId: STAFF, closeNote: 'Selesai' },
      { nowMs: now },
    )

    expect(closed.expectedCash).toBe(1_782_100)
    expect(closed.variance).toBe(-2_100)
    expect(closed.shift.status).toBe('CLOSED')
    expect(closed.shift.counted_cash).toBe(1_780_000)

    const outbox = await db.outbox_command.toArray()
    const closeCmd = outbox.find((c) => c.type === 'CloseShift')
    expect(closeCmd).toBeDefined()
    expect(closeCmd!.depends_on.length).toBeGreaterThanOrEqual(4)
    expect(() => parseCommandPayload('CloseShift', 1, closeCmd!.payload)).not.toThrow()
    expect(outbox.some((c) => c.type === 'AppendAudit' && (c.payload as { entry: { action: string } }).entry.action === 'shift.variance')).toBe(true)

    await expect(
      closeShift(db, { countedCash: 1_782_100, staffId: STAFF }),
    ).rejects.toMatchObject({ code: 'SHIFT_NOT_OPEN' } satisfies Partial<CloseShiftError>)
  })
})
