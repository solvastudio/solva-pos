import { afterEach, describe, expect, it } from 'vitest'
import { parseCommandPayload } from '~/lib/contracts'
import { toMoney } from '~/lib/kernel'
import { buildCartDraftId, saveActiveDraft } from '../../data/cart-draft.repo'
import { invoiceCounterKey, peekSeq } from '../../data/counter.repo'
import { setMeta } from '../../data/meta.repo'
import { listSendable } from '../../data/outbox.repo'
import { getPrintJobForEntity } from '../../data/print-job.repo'
import { getSaleWithDetails } from '../../data/sale.repo'
import { deleteTenantDbForTests, openTenantDb } from '../../db/solva-db'
import { addItem, createEmptyCart, setBillDiscount, setLineDiscount, type CartState } from '../../domain/cart'

function mustOk<T extends { readonly ok: true; readonly cart: CartState } | { readonly ok: false; readonly error: string }>(res: T): CartState {
  if (!res.ok) throw new Error(`Cart error: ${res.error}`)
  return res.cart
}
import { onPosEvent } from '../../state/events'
import { openShift } from '../shift/open-shift'
import { finalizeSale, FinalizeSaleError } from './finalize-sale'

const T1 = '0192a000-0000-7000-8000-00000000c101'
const OUT = '0192a000-0000-7000-8000-00000000c102'
const REG = '0192a000-0000-7000-8000-00000000c103'
const DEV = '0192a000-0000-7000-8000-00000000c104'
const STAFF = '0192a000-0000-7000-8000-00000000c105'
const SUP = '0192a000-0000-7000-8000-00000000c106'
const LE = '0192a000-0000-7000-8000-00000000c107'
const TR = '0192a000-0000-7000-8000-00000000c108'
const PM_CASH = '0192a000-0000-7000-8000-00000000c109'
const PM_QRIS = '0192a000-0000-7000-8000-00000000c110'

const makeUuidFactory = () => {
  let seq = 1
  return () => `0192a000-0000-7000-8000-00000000d${String(seq++).padStart(3, '0')}`
}

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

async function seedPosEnv(withPrefix = true) {
  const db = await openTenantDb(T1)
  await setMeta(db, 'device', {
    device_id: DEV,
    credential: 'cred-1',
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant_id: T1,
    slug: 'demo',
    register_id: REG,
    outlet_id: OUT,
    register_type: 'CASHIER',
  })
  await setMeta(db, 'clock', {
    offset_ms: 0,
    offset_at: '2026-11-30T00:00:00.000Z',
    max_seen_time: '2026-11-30T00:00:00.000Z',
  })
  await db.legal_entity.put({
    id: LE,
    name: 'PT Solva',
    npwp: null,
    is_pkp: false,
    deleted_at: null,
  })
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
    service_charge_enabled: false,
    service_charge_rate: '0',
    service_charge_taxable: true,
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
  await db.outlet_receipt_setting.put({
    id: '0192a000-0000-7000-8000-00000000c198',
    outlet_id: OUT,
    receipt_locale: 'id-ID',
    deleted_at: null,
  })
  if (withPrefix) {
    await db.register_invoice_prefix.put({
      id: '0192a000-0000-7000-8000-00000000c199',
      register_id: REG,
      effective_month: '2026-11-01',
      invoice_prefix: 'OUT01-POS02',
      deleted_at: null,
    })
  }
  return db
}

function makeV04Cart(finalizeId: string, createdAt = '2026-11-30T10:00:00.000Z') {
  const uuid = makeUuidFactory()
  let cart = createEmptyCart({
    finalizeId,
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
    createdAt,
    shiftId: null,
  })
  cart = mustOk(addItem(
    cart,
    {
      skuId: '0192a000-0000-7000-8000-00000000a101',
      productId: '0192a000-0000-7000-8000-00000000a201',
      uomId: '0192a000-0000-7000-8000-00000000a301',
      skuCode: 'KOP',
      itemName: 'Kopi',
      uomCode: 'pcs',
      conversionFactor: '1',
      taxable: true,
      allowFraction: false,
      price: { kind: 'PRICE', price: toMoney(18_500), source: 'OUTLET' },
    },
    { newId: uuid(), qtyInput: '2' },
  ))
  cart = mustOk(addItem(
    cart,
    {
      skuId: '0192a000-0000-7000-8000-00000000a102',
      productId: '0192a000-0000-7000-8000-00000000a202',
      uomId: '0192a000-0000-7000-8000-00000000a301',
      skuCode: 'GUL',
      itemName: 'Gula 1kg',
      uomCode: 'pcs',
      conversionFactor: '1',
      taxable: true,
      allowFraction: false,
      price: { kind: 'PRICE', price: toMoney(16_000), source: 'DEFAULT' },
    },
    { newId: uuid() },
  ))
  const susuRes = addItem(
    cart,
    {
      skuId: '0192a000-0000-7000-8000-00000000a103',
      productId: '0192a000-0000-7000-8000-00000000a203',
      uomId: '0192a000-0000-7000-8000-00000000a301',
      skuCode: 'SUS',
      itemName: 'Susu UHT 1L',
      uomCode: 'pcs',
      conversionFactor: '1',
      taxable: true,
      allowFraction: false,
      price: { kind: 'PRICE', price: toMoney(17_900), source: 'OUTLET' },
    },
    { newId: uuid(), qtyInput: '3' },
  )
  if (!susuRes.ok) throw new Error('expected ok')
  cart = mustOk(setLineDiscount(susuRes.cart, susuRes.touchedLineId, { type: 'PERCENT', pct: '10' }))
  return cart
}

describe('pos/usecases/sales/finalize-sale (AD-14)', () => {
  it('rolls back completely when commit hook throws (counter not burned, cart draft intact)', async () => {
    const db = await seedPosEnv(true)
    const now = () => Date.parse('2026-11-30T10:00:00.000Z')
    const shiftRes = await openShift(db, { openingCash: 200_000, staffId: STAFF }, { nowMs: now })
    expect(shiftRes.ok).toBe(true)

    const cart = makeV04Cart('0192a000-0000-7000-8000-00000000f001')
    await saveActiveDraft(db, {
      id: buildCartDraftId(REG, STAFF),
      kind: 'CART',
      register_id: REG,
      staff_id: STAFF,
      status: 'ACTIVE',
      bill_key: 'CURRENT',
      payload: cart,
      updated_at: '2026-11-30T10:00:00.000Z',
    })

    const cashPay = [
      {
        methodId: PM_CASH,
        methodCode: 'CASH',
        methodName: 'Tunai',
        kind: 'CASH' as const,
        amount: toMoney(150_000),
      },
    ]

    await expect(
      finalizeSale(
        db,
        { cart, payments: cashPay, staffId: STAFF },
        {
          nowMs: now,
          newId: makeUuidFactory(),
          beforeCommitHookForTest: () => {
            throw new Error('Injected print_job failure')
          },
        },
      ),
    ).rejects.toThrow('Injected print_job failure')

    // Complete rollback: no sale, counter at 0, draft still ACTIVE, only OpenShift in outbox
    expect(await db.sale.count()).toBe(0)
    expect(await peekSeq(db, invoiceCounterKey(REG, '1126'))).toBe(0)
    expect((await db.cart_draft.get(buildCartDraftId(REG, STAFF)))?.status).toBe('ACTIVE')
    expect((await db.outbox_command.count())).toBe(1)

    // Subsequent retry succeeds with seq=1
    const okRes = await finalizeSale(
      db,
      { cart, payments: cashPay, staffId: STAFF },
      { nowMs: now, newId: makeUuidFactory() },
    )
    expect(okRes.invoiceNo).toBe('OUT01-POS02-1126-000001')
    expect(okRes.change).toBe(37_500)
    expect((await db.cart_draft.get(buildCartDraftId(REG, STAFF)))?.status).toBe('USED')

    // Duplicate click / finalizeId idempotency returns same invoiceNo & single sale row
    const replay = await finalizeSale(
      db,
      { cart, payments: cashPay, staffId: STAFF },
      { nowMs: now, newId: makeUuidFactory() },
    )
    expect(replay).toEqual(okRes)
    expect(await db.sale.count()).toBe(1)
    expect(await peekSeq(db, invoiceCounterKey(REG, '1126'))).toBe(1)
  })

  it('serializes parallel finalizations sequentially without gaps, handles V-29 period rollover, and writes valid outbox + print_job', async () => {
    const db = await seedPosEnv(true)
    const nowBeforeCutoff = () => Date.parse('2026-11-30T19:00:00.000Z') // 2026-12-01 02:00 WIB -> period 1126 (V-29)
    const nowAfterCutoff = () => Date.parse('2026-11-30T21:30:00.000Z') // 2026-12-01 04:30 WIB -> period 1226

    const shiftRes = await openShift(db, { openingCash: 100_000, staffId: STAFF }, { nowMs: nowBeforeCutoff })
    expect(shiftRes.ok).toBe(true)
    if (!shiftRes.ok) return

    const firedEvents: string[] = []
    const unsub = onPosEvent('finalized', ({ saleId }) => firedEvents.push(saleId))

    const cashPay = [
      {
        methodId: PM_CASH,
        methodCode: 'CASH',
        methodName: 'Tunai',
        kind: 'CASH' as const,
        amount: toMoney(150_000),
      },
    ]

    const saleA = makeV04Cart('0192a000-0000-7000-8000-00000000f101')
    const saleB = makeV04Cart('0192a000-0000-7000-8000-00000000f102')
    const saleC = mustOk(setBillDiscount(
      makeV04Cart('0192a000-0000-7000-8000-00000000f103', '2026-11-30T21:30:00.000Z'),
      { type: 'NOMINAL', input: toMoney(5_000) },
    ))

    const newId = makeUuidFactory()
    const [resA, resB] = await Promise.all([
      finalizeSale(
        db,
        {
          cart: saleA,
          payments: cashPay,
          staffId: STAFF,
          approvals: [{ action: 'discount.approve', approverId: SUP, reasonText: 'VIP' }],
        },
        { nowMs: nowBeforeCutoff, newId },
      ),
      finalizeSale(
        db,
        { cart: saleB, payments: cashPay, staffId: STAFF },
        { nowMs: nowBeforeCutoff, newId },
      ),
    ])

    unsub()

    expect([resA.invoiceNo, resB.invoiceNo].sort()).toEqual([
      'OUT01-POS02-1126-000001',
      'OUT01-POS02-1126-000002',
    ])
    expect(firedEvents).toHaveLength(2)

    // Roll over across 04:00 WIB -> new period 1226 starts at 000001
    const resC = await finalizeSale(
      db,
      {
        cart: saleC,
        payments: [
          {
            methodId: PM_QRIS,
            methodCode: 'QRIS',
            methodName: 'QRIS',
            kind: 'NON_CASH',
            amount: toMoney(50_000),
            reference: 'REF-1',
          },
          {
            methodId: PM_CASH,
            methodCode: 'CASH',
            methodName: 'Tunai',
            kind: 'CASH',
            amount: toMoney(80_000),
          },
        ],
        staffId: STAFF,
      },
      { nowMs: nowAfterCutoff, newId },
    )
    expect(resC.invoiceNo).toBe('OUT01-POS02-1226-000001')

    const sendableBeforeOpenAck = await listSendable(db, { nowIso: '2026-12-01T00:00:00.000Z' })
    expect(sendableBeforeOpenAck.map((c) => c.type)).toEqual(['OpenShift'])

    const allOutbox = (await db.outbox_command.toArray()).sort(
      (a, b) => a.device_seq - b.device_seq,
    )
    const finalizeCmds = allOutbox.filter((c) => c.type === 'FinalizeSale')
    expect(finalizeCmds).toHaveLength(3)
    expect(finalizeCmds[0]!.depends_on).toEqual([shiftRes.command.id])
    for (const cmd of finalizeCmds) {
      expect(() => parseCommandPayload('FinalizeSale', 1, cmd.payload)).not.toThrow()
    }
    expect(allOutbox.filter((c) => c.type === 'AppendAudit')).toHaveLength(1)

    const printJob = await getPrintJobForEntity(db, resA.saleId)
    expect(printJob?.status).toBe('QUEUED')
    expect(printJob?.kind).toBe('RECEIPT')

    const detailsA = await getSaleWithDetails(db, resA.saleId)
    expect(detailsA?.lines).toHaveLength(3)
    expect(detailsA?.payments).toHaveLength(1)
  })

  it('rejects finalizing without an open shift or missing invoice prefix', async () => {
    const db = await seedPosEnv(false)
    const cart = makeV04Cart('0192a000-0000-7000-8000-00000000f201')
    const cashPay = [
      {
        methodId: PM_CASH,
        methodCode: 'CASH',
        methodName: 'Tunai',
        kind: 'CASH' as const,
        amount: toMoney(150_000),
      },
    ]

    await expect(
      finalizeSale(db, { cart, payments: cashPay, staffId: STAFF }),
    ).rejects.toMatchObject({ code: 'SHIFT_REQUIRED' } satisfies Partial<FinalizeSaleError>)

    await openShift(db, { openingCash: 0, staffId: STAFF })
    await expect(
      finalizeSale(db, { cart, payments: cashPay, staffId: STAFF }),
    ).rejects.toMatchObject({ code: 'PREFIX_NOT_CONFIGURED' } satisfies Partial<FinalizeSaleError>)
  })
})
