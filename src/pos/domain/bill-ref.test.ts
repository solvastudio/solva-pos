import { afterEach, describe, expect, it } from 'vitest'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { seedSeq } from '../data/counter.repo'
import { billRefCounterKey, formatBillRef, nextBillRef } from './bill-ref'

const T1 = '01950000-0000-7000-8000-00000000b101'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/domain/bill-ref', () => {
  it('formats 4-digit operational bill references and scales to 5+ digits past 9999', () => {
    expect(formatBillRef('M05', 3)).toBe('M05-0003')
    expect(formatBillRef('M05', 10000)).toBe('M05-10000')
  })

  it('increments local counter atomically inside the caller transaction', async () => {
    const db = await openTenantDb(T1)
    await seedSeq(db, billRefCounterKey('t5', 'd1'), 9998)

    const refs = await db.transaction('rw', db.local_counter, async (tx) => {
      const a = await nextBillRef(tx, { tableId: 't5', tableCode: 'M05', deviceId: 'd1' })
      const b = await nextBillRef(tx, { tableId: 't5', tableCode: 'M05', deviceId: 'd1' })
      return [a, b]
    })

    expect(refs).toEqual(['M05-9999', 'M05-10000'])
  })
})
