import { afterEach, describe, expect, it } from 'vitest'
import { parseCommandPayload } from '~/lib/contracts'
import { toMoney } from '~/lib/kernel'
import { setMeta } from '../../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../../db/solva-db'
import { addItem, createEmptyCart } from '../../domain/cart'
import { closeShift } from '../shift/close-shift'
import { openShift } from '../shift/open-shift'
import { finalizeSale } from './finalize-sale'
import { voidSale, VoidSaleError } from './void-sale'

const T1 = '0192a000-0000-7000-8000-00000000b101'
const OUT = '0192a000-0000-7000-8000-00000000b102'
const REG = '0192a000-0000-7000-8000-00000000b103'
const DEV = '0192a000-0000-7000-8000-00000000b104'
const STAFF = '0192a000-0000-7000-8000-00000000b105'
const SUP = '0192a000-0000-7000-8000-00000000b106'
const LE = '0192a000-0000-7000-8000-00000000b107'
const PM_CASH = '0192a000-0000-7000-8000-00000000b108'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

async function seedEnvAndSale() {
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
  await db.legal_entity.put({ id: LE, name: 'PT Demo', npwp: null, is_pkp: false, deleted_at: null })
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

  const now = () => Date.parse('2026-11-20T08:00:00.000Z')
  await openShift(db, { openingCash: 200_000, staffId: STAFF }, { nowMs: now })

  let cart = createEmptyCart({
    finalizeId: '0192a000-0000-7000-8000-00000000b201',
    config: {
      priceTaxMode: 'EXCLUSIVE',
      taxProfile: 'NONE',
      taxRate: '0',
      serviceChargeEnabled: false,
      serviceChargeRate: '0',
      serviceChargeTaxable: true,
    },
    cashRoundingUnit: 100,
    taxRateId: null,
    createdAt: '2026-11-20T08:00:00.000Z',
    shiftId: null,
  })
  const added = addItem(
    cart,
    {
      skuId: '0192a000-0000-7000-8000-00000000b301',
      productId: '0192a000-0000-7000-8000-00000000b302',
      uomId: '0192a000-0000-7000-8000-00000000b303',
      skuCode: 'KOP',
      itemName: 'Kopi',
      uomCode: 'pcs',
      conversionFactor: '1',
      taxable: false,
      allowFraction: false,
      price: { kind: 'PRICE', price: toMoney(25_000), source: 'DEFAULT' },
    },
    { newId: '0192a000-0000-7000-8000-00000000b304' },
  )
  if (!added.ok) throw new Error('expected ok')
  cart = added.cart

  const finalized = await finalizeSale(
    db,
    {
      cart,
      payments: [
        {
          methodId: PM_CASH,
          methodCode: 'CASH',
          methodName: 'Tunai',
          kind: 'CASH',
          amount: toMoney(25_000),
        },
      ],
      staffId: STAFF,
    },
    { nowMs: now },
  )

  return { db, saleId: finalized.saleId, invoiceNo: finalized.invoiceNo, now }
}

describe('pos/usecases/sales/void-sale', () => {
  it('voids PAID sale in same open shift, keeps invoiceNo, queues valid VoidSale with FinalizeSale dependency, and rejects duplicate/self-approval', async () => {
    const { db, saleId, invoiceNo, now } = await seedEnvAndSale()

    await expect(
      voidSale(db, {
        saleId,
        requesterId: STAFF,
        approverId: STAFF,
        reasonCode: 'MISTAKE',
        reasonText: 'Wrong item',
      }),
    ).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' } satisfies Partial<VoidSaleError>)

    const voided = await voidSale(
      db,
      {
        saleId,
        requesterId: STAFF,
        approverId: SUP,
        reasonCode: 'MISTAKE',
        reasonText: 'Wrong item',
      },
      { nowMs: now },
    )

    expect(voided.status).toBe('VOID')
    expect(voided.invoice_no).toBe(invoiceNo)
    expect(voided.void_approved_by).toBe(SUP)

    const outbox = await db.outbox_command.toArray()
    const voidCmd = outbox.find((c) => c.type === 'VoidSale')
    expect(voidCmd).toBeDefined()
    expect(voidCmd!.depends_on).toEqual([saleId])
    expect(() => parseCommandPayload('VoidSale', 1, voidCmd!.payload)).not.toThrow()
    expect(outbox.some((c) => c.type === 'AppendAudit')).toBe(true)

    await expect(
      voidSale(db, {
        saleId,
        requesterId: STAFF,
        approverId: SUP,
        reasonCode: 'MISTAKE',
        reasonText: 'Again',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_VOIDED' } satisfies Partial<VoidSaleError>)
  })

  it('rejects void after shift closes', async () => {
    const { db, saleId, now } = await seedEnvAndSale()
    await closeShift(db, { countedCash: 225_000, staffId: STAFF }, { nowMs: now })

    await expect(
      voidSale(db, {
        saleId,
        requesterId: STAFF,
        approverId: SUP,
        reasonCode: 'MISTAKE',
        reasonText: 'Late void',
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_CLOSED' } satisfies Partial<VoidSaleError>)
  })
})
