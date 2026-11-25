import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { foldBillEvents, type BillEventEnvelopeV1 } from '~/modules/fnb/shared'
import { setMeta } from './meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import {
  addBillItem,
  cancelBill,
  changeBillItemQty,
  getLocalBillWithItems,
  listBillEventsForBill,
  listChildBillsByParent,
  mergeBillsLocal,
  openBill,
  printPrebill,
  setBillCustomer,
  setBillDiscount,
  setBillItemModifiers,
  setBillTable,
  splitBillLocal,
  voidBillItem,
} from './bill.repo'
import { buildCartFromBill } from '../domain/bill-payment'
import type { ResolvedCartItem } from '../domain/cart'

const T1 = '01950000-0000-7000-8000-00000000c101'
const DEV1 = '01950000-0000-7000-8000-00000000d101'
const DEV2 = '01950000-0000-7000-8000-00000000d102'
const REG1 = '01950000-0000-7000-8000-000000001101'
const OUT1 = '01950000-0000-7000-8000-000000002101'
const STAFF1 = '01950000-0000-7000-8000-000000003101'
const TABLE1 = '01950000-0000-7000-8000-00000000a101'
const TABLE2 = '01950000-0000-7000-8000-00000000a102'
const MOD1 = '01950000-0000-7000-8000-00000000f101'

const SAMPLE_MENU_ITEM: ResolvedCartItem = {
  skuId: '01950000-0000-7000-8000-00000000e101',
  productId: '01950000-0000-7000-8000-000000004101',
  uomId: '01950000-0000-7000-8000-000000005101',
  skuCode: 'NASGOR',
  itemName: 'Nasi Goreng',
  uomCode: 'pcs',
  conversionFactor: '1',
  taxable: true,
  allowFraction: false,
  price: { kind: 'PRICE', price: toMoney(35000), source: 'DEFAULT' },
}

async function seedPosDb() {
  const db = await openTenantDb(T1)
  await setMeta(db, 'device', {
    device_id: DEV1,
    credential: 'cred-1',
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant_id: T1,
    slug: 'warung',
    register_id: REG1,
    outlet_id: OUT1,
    register_type: 'WAITER',
  })
  await setMeta(db, 'clock', {
    offset_ms: 0,
    offset_at: '2026-11-24T12:00:00.000Z',
    max_seen_time: '2026-11-24T12:00:00.000Z',
  })
  await db.outlet.put({
    id: OUT1,
    legal_entity_id: '01950000-0000-7000-8000-00000000l101',
    code: 'OUT1',
    name: 'Outlet 1',
    timezone: 'Asia/Jakarta',
    day_cutoff_time: '00:00:00',
    price_tax_mode: 'EXCLUSIVE',
    tax_profile: 'PB1',
    deleted_at: null,
  })
  await db.fnb_table.bulkPut([
    {
      id: TABLE1,
      outlet_id: OUT1,
      area: 'Main',
      code: 'M05',
      capacity: 4,
      is_active: true,
      sort_order: 1,
      deleted_at: null,
    },
    {
      id: TABLE2,
      outlet_id: OUT1,
      area: 'Main',
      code: 'M06',
      capacity: 2,
      is_active: true,
      sort_order: 2,
      deleted_at: null,
    },
  ])
  return db
}

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/data/bill.repo (atomic Dexie actions)', () => {
  it('commits event, projection, counters, and outbox atomically; prebill clears awaiting_payment on next item add', async () => {
    const db = await seedPosDb()
    const opened = await openBill(db, { tableId: TABLE1, staffId: STAFF1 })
    expect(opened.bill.bill_ref).toBe('M05-0001')
    expect(opened.bill.last_event_seq).toBe(1)

    const added = await addBillItem(db, {
      billId: opened.bill.id,
      item: SAMPLE_MENU_ITEM,
      isAvailable: true,
      qtyInput: '2',
      modifiers: [{ modifier_id: MOD1, name: 'Extra Sambal', price_delta: toMoney(2000), qty: 1 }],
      staffId: STAFF1,
    })
    expect(added.bill.last_event_seq).toBe(2)

    await printPrebill(db, { billId: opened.bill.id, staffId: STAFF1 })
    let cur = await getLocalBillWithItems(db, opened.bill.id)
    expect(cur!.bill.is_awaiting_payment).toBe(true)
    expect(cur!.items[0]!.unit_price).toBe(37000)

    await changeBillItemQty(db, {
      billId: opened.bill.id,
      itemId: added.itemId,
      qtyInput: '3',
      staffId: STAFF1,
    })
    cur = await getLocalBillWithItems(db, opened.bill.id)
    expect(cur!.bill.is_awaiting_payment).toBe(false)
    expect(cur!.items[0]!.qty).toBe('3')

    await voidBillItem(db, {
      billId: opened.bill.id,
      itemId: added.itemId,
      reasonText: 'Salah pesan',
      staffId: STAFF1,
    })
    await cancelBill(db, { billId: opened.bill.id, staffId: STAFF1 })
    cur = await getLocalBillWithItems(db, opened.bill.id)
    expect(cur!.bill.status).toBe('CANCELED')

    const outbox = await db.outbox_command.toArray()
    expect(outbox).toHaveLength(6)
    expect(outbox.every((o) => o.type === 'AppendBillEvents')).toBe(true)
    // No stock or invoice counter touched
    const counters = await db.local_counter.toArray()
    expect(counters.some((c) => c.doc_type === 'INVOICE')).toBe(false)
  })

  it('rolls back event, projection, outbox, and counters completely when transaction aborts mid-commit', async () => {
    const db = await seedPosDb()
    const opened = await openBill(db, { tableId: TABLE1, staffId: STAFF1 })
    const seqBefore = (await listBillEventsForBill(db, opened.bill.id)).length

    await expect(
      addBillItem(
        db,
        {
          billId: opened.bill.id,
          item: SAMPLE_MENU_ITEM,
          isAvailable: true,
          staffId: STAFF1,
        },
        {
          beforeCommitHookForTest: () => {
            throw new Error('simulated crash mid-tx')
          },
        },
      ),
    ).rejects.toThrow('simulated crash mid-tx')

    expect((await listBillEventsForBill(db, opened.bill.id)).length).toBe(seqBefore)
    const cur = await getLocalBillWithItems(db, opened.bill.id)
    expect(cur!.items).toHaveLength(0)
    expect(await db.outbox_command.count()).toBe(1)
  })

  it('rejects edits on read-only bills held by another device or pending handover', async () => {
    const db = await seedPosDb()
    const opened = await openBill(db, { tableId: TABLE1, staffId: STAFF1 })
    await db.bill.update(opened.bill.id, { lease_device_id: DEV2 })

    await expect(
      addBillItem(db, { billId: opened.bill.id, item: SAMPLE_MENU_ITEM, isAvailable: true, staffId: STAFF1 }),
    ).rejects.toMatchObject({ code: 'READ_ONLY_OTHER' })
  })

  it('matches pure foldBillEvents(events) across random action sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('add', 'qty', 'mod', 'cust', 'table', 'disc', 'prebill', 'void'), {
          minLength: 3,
          maxLength: 10,
        }),
        async (ops) => {
          await deleteTenantDbForTests(T1)
          const db = await seedPosDb()
          const opened = await openBill(db, { tableId: TABLE1, staffId: STAFF1 })
          let lastActiveItemId: string | null = null

          for (const op of ops) {
            if (op === 'add') {
              const r = await addBillItem(db, {
                billId: opened.bill.id,
                item: SAMPLE_MENU_ITEM,
                isAvailable: true,
                staffId: STAFF1,
              })
              lastActiveItemId = r.itemId
            } else if (op === 'qty' && lastActiveItemId) {
              await changeBillItemQty(db, {
                billId: opened.bill.id,
                itemId: lastActiveItemId,
                qtyInput: '2',
                staffId: STAFF1,
              })
            } else if (op === 'mod' && lastActiveItemId) {
              await setBillItemModifiers(db, {
                billId: opened.bill.id,
                itemId: lastActiveItemId,
                modifiers: [{ modifier_id: MOD1, name: 'Sambal', price_delta: toMoney(1000), qty: 1 }],
                staffId: STAFF1,
              })
            } else if (op === 'cust') {
              await setBillCustomer(db, { billId: opened.bill.id, customerName: 'Budi', staffId: STAFF1 })
            } else if (op === 'table') {
              await setBillTable(db, { billId: opened.bill.id, tableId: TABLE2, staffId: STAFF1 })
            } else if (op === 'disc') {
              await setBillDiscount(db, {
                billId: opened.bill.id,
                discount: { type: 'PERCENT', pct: '5' },
                staffId: STAFF1,
              })
            } else if (op === 'prebill') {
              await printPrebill(db, { billId: opened.bill.id, staffId: STAFF1 })
            } else if (op === 'void' && lastActiveItemId) {
              await voidBillItem(db, {
                billId: opened.bill.id,
                itemId: lastActiveItemId,
                reasonText: 'Cancel item',
                staffId: STAFF1,
              })
              lastActiveItemId = null
            }
          }

          const events = await listBillEventsForBill(db, opened.bill.id)
          const folded = foldBillEvents(
            opened.bill.id,
            events as unknown as BillEventEnvelopeV1[],
          )
          const local = await getLocalBillWithItems(db, opened.bill.id)
          expect(local!.bill.last_event_seq).toBe(folded.lastEventSeq)
          expect(local!.bill.table_id).toBe(folded.tableId)
          expect(local!.bill.is_awaiting_payment).toBe(
            folded.prebillSeq !== null && folded.prebillSeq > folded.lastContentSeq,
          )
          expect(local!.items.length).toBe(folded.items.size)
        },
      ),
      { numRuns: 10 },
    )
  })

  it('splits EQUAL and merges bills offline cleanly with local_counter and SHARE/STOCK_BASIS cart projection', async () => {
    const db = await seedPosDb()
    const b1 = await openBill(db, { tableId: TABLE1, staffId: STAFF1 })
    const b2 = await openBill(db, { tableId: TABLE2, staffId: STAFF1 })

    await addBillItem(db, { billId: b1.bill.id, item: SAMPLE_MENU_ITEM, isAvailable: true, staffId: STAFF1, qtyInput: '2' })
    await addBillItem(db, { billId: b2.bill.id, item: SAMPLE_MENU_ITEM, isAvailable: true, staffId: STAFF1, qtyInput: '1' })

    const merged = await mergeBillsLocal(db, {
      targetBillId: b1.bill.id,
      sourceBillIds: [b2.bill.id],
      staffId: STAFF1,
    })
    expect(merged.target.status).toBe('OPEN')

    const b1AfterMerge = await getLocalBillWithItems(db, b1.bill.id)
    expect(b1AfterMerge!.items.filter((i) => i.status === 'ACTIVE')).toHaveLength(1)
    expect(Number(b1AfterMerge!.items[0]!.qty)).toBe(3)
    const b2AfterMerge = await getLocalBillWithItems(db, b2.bill.id)
    expect(b2AfterMerge!.bill.status).toBe('MERGED')

    const split = await splitBillLocal(db, {
      parentBillId: b1.bill.id,
      splitMode: 'EQUAL',
      children: [
        { shareIndex: 1, shareCount: 3, items: [] },
        { shareIndex: 2, shareCount: 3, items: [] },
        { shareIndex: 3, shareCount: 3, items: [] },
      ],
      staffId: STAFF1,
    })
    expect(split.parent.status).toBe('SPLIT')
    expect(split.children).toHaveLength(3)

    const kids = await listChildBillsByParent(db, b1.bill.id)
    expect(kids).toHaveLength(3)
    const share1WithItems = await getLocalBillWithItems(db, kids[0]!.id)
    const parentWithItems = await getLocalBillWithItems(db, b1.bill.id)

    // Share 1 while other siblings are still OPEN -> SHARE line only (no STOCK_BASIS)
    const cart1 = buildCartFromBill({
      billWithItems: share1WithItems!,
      parentBillWithItems: parentWithItems!,
      siblingBills: kids,
      shiftId: 'shift-1',
      finalizeId: 'fin-1',
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
      nowIso: '2026-11-25T10:00:00.000Z',
    })
    expect(cart1.lines).toHaveLength(1)
    expect(cart1.lines[0]?.lineKind).toBe('SHARE')

    // Mark siblings 1 & 2 PAID -> Share 3 gets SHARE + STOCK_BASIS
    await db.bill.update(kids[0]!.id, { status: 'PAID' })
    await db.bill.update(kids[1]!.id, { status: 'PAID' })
    const kidsUpdated = await listChildBillsByParent(db, b1.bill.id)
    const share3WithItems = await getLocalBillWithItems(db, kidsUpdated[2]!.id)
    const cart3 = buildCartFromBill({
      billWithItems: share3WithItems!,
      parentBillWithItems: parentWithItems!,
      siblingBills: kidsUpdated,
      shiftId: 'shift-1',
      finalizeId: 'fin-3',
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
      nowIso: '2026-11-25T10:00:00.000Z',
    })
    expect(cart3.lines.map((l) => l.lineKind)).toEqual(['SHARE', 'STOCK_BASIS'])
  })
})
