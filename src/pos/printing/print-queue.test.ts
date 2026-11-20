import { afterEach, describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { setMeta } from '../data/meta.repo'
import { addPrintJob, getPrintJobById } from '../data/print-job.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { addItem, createEmptyCart } from '../domain/cart'
import { finalizeSale } from '../usecases/sales/finalize-sale'
import { openShift } from '../usecases/shift/open-shift'
import { VirtualPrinterAdapter } from './adapters/virtual'
import { PrintQueueWorker } from './print-queue'

const T1 = '0192a000-0000-7000-8000-00000000e101'
const OUT = '0192a000-0000-7000-8000-00000000e102'
const REG = '0192a000-0000-7000-8000-00000000e103'
const DEV = '0192a000-0000-7000-8000-00000000e104'
const STAFF = '0192a000-0000-7000-8000-00000000e105'
const LE = '0192a000-0000-7000-8000-00000000e106'
const PM_CASH = '0192a000-0000-7000-8000-00000000e107'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

async function seedPrintDb() {
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
  await db.outlet.put({
    id: OUT,
    legal_entity_id: LE,
    code: 'OUT01',
    name: 'Toko Solva',
    timezone: 'Asia/Jakarta',
    day_cutoff_time: '04:00',
    price_tax_mode: 'EXCLUSIVE',
    tax_profile: 'NONE',
    cash_rounding_unit: 100,
    deleted_at: null,
  })
  await db.legal_entity.put({ id: LE, name: 'PT Solva', npwp: null, is_pkp: false, deleted_at: null })
  await db.cash_master.put({
    id: REG,
    outlet_id: OUT,
    code: 'POS01',
    name: 'Kasir 1',
    register_type: 'CASHIER',
    paper_width_mm: 58,
    invoice_prefix: 'OUT01-POS01',
    deleted_at: null,
  })
  await db.register_invoice_prefix.put({
    id: 'p1',
    register_id: REG,
    effective_month: '2026-11-01',
    invoice_prefix: 'OUT01-POS01',
    deleted_at: null,
  })
  await db.app_user.put({ id: STAFF, display_name: 'Dewi', is_active: true, deleted_at: null })
  await db.payment_method.put({
    id: PM_CASH,
    code: 'CASH',
    name: 'Tunai',
    kind: 'CASH',
    requires_reference: false,
    sort_order: 1,
    is_active: true,
    deleted_at: null,
  })
  return db
}

describe('pos/printing/print-queue', () => {
  it('runs CASH_DRAWER ahead of RECEIPT FIFO, handles retries, boot recovery, passive skip, and non-blocking failure', async () => {
    const db = await seedPrintDb()
    const now = () => Date.parse('2026-11-20T07:05:00.000Z')
    await openShift(db, { openingCash: 100_000, staffId: STAFF }, { nowMs: now })

    let cart = createEmptyCart({
      finalizeId: '0192a000-0000-7000-8000-00000000e201',
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
      createdAt: '2026-11-20T07:05:00.000Z',
      shiftId: null,
    })
    const add = addItem(
      cart,
      {
        skuId: '0192a000-0000-7000-8000-00000000e301',
        productId: '0192a000-0000-7000-8000-00000000e302',
        uomId: '0192a000-0000-7000-8000-00000000e303',
        skuCode: 'KOP',
        itemName: 'Kopi',
        uomCode: 'pcs',
        conversionFactor: '1',
        taxable: false,
        allowFraction: false,
        price: { kind: 'PRICE', price: toMoney(20_000), source: 'DEFAULT' },
      },
      { newId: '0192a000-0000-7000-8000-00000000e304' },
    )
    if (!add.ok) throw new Error('ok')
    cart = add.cart

    const saleRes = await finalizeSale(
      db,
      {
        cart,
        payments: [
          {
            methodId: PM_CASH,
            methodCode: 'CASH',
            methodName: 'Tunai',
            kind: 'CASH',
            amount: toMoney(20_000),
          },
        ],
        staffId: STAFF,
      },
      { nowMs: now },
    )

    const initialJobs = await db.print_job.toArray()
    expect(initialJobs.map((j) => j.kind).sort()).toEqual(['CASH_DRAWER', 'RECEIPT'])

    // Passive instance must NOT touch the adapter
    const adapter = new VirtualPrinterAdapter({ profileId: 'escpos-58' })
    const passiveWorker = new PrintQueueWorker({
      db,
      getAdapter: () => adapter,
      isActiveInstance: () => false,
    })
    await passiveWorker.kick()
    expect(adapter.printedBatches).toHaveLength(0)

    // Active worker drains drawer pulse FIRST, then receipt ESC/POS bytes -> DONE
    const worker = new PrintQueueWorker({
      db,
      getAdapter: () => adapter,
      retryDelaysMs: [0, 0, 0],
      sleep: async () => {},
    })
    await worker.kick()

    expect(adapter.drawerPulseCount).toBe(1)
    expect(adapter.printedBatches).toHaveLength(2)
    expect(adapter.printedBatches[0]!.length).toBeLessThan(16) // drawer pulse
    expect(adapter.printedBatches[1]!.length).toBeGreaterThan(50) // full receipt bytes

    const finishedJobs = await db.print_job.toArray()
    expect(finishedJobs.every((j) => j.status === 'DONE' && j.first_byte_at !== null)).toBe(true)

    // Simulate boot recovery for stuck PRINTING job
    await addPrintJob(db, {
      id: 'stuck-1',
      kind: 'TEST',
      status: 'PRINTING',
      entity_id: REG,
      receipt_locale: 'id-ID',
      attempts: 1,
      last_error: null,
      created_at: '2026-11-20T08:00:00.000Z',
      updated_at: '2026-11-20T08:00:00.000Z',
    })
    expect(await worker.recoverAtBoot()).toBe(1)
    expect((await getPrintJobById(db, 'stuck-1'))!.status).toBe('QUEUED')

    // Missing adapter -> NO_PRINTER fails immediately, logs PRINT_FAILED, sale untouched
    const noAdapterWorker = new PrintQueueWorker({ db, getAdapter: () => null })
    await noAdapterWorker.kick()
    expect((await getPrintJobById(db, 'stuck-1'))!.status).toBe('FAILED')
    expect((await db.device_log.toArray()).some((l) => l.code === 'PRINT_FAILED')).toBe(true)
    expect((await db.sale.get(saleRes.saleId))!.status).toBe('PAID')
  })
})
