import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { tenantDbName } from '../locks/names'
import { closeTenantDb, openTenantDb } from '../db/solva-db'
import {
  billSeqCounterKey,
  creditNoteCounterKey,
  DEVICE_SEQ_KEY,
  invoiceCounterKey,
  nextSeq,
  peekSeq,
} from './counter.repo'

const T = '0192a000-0000-7000-8000-00000000a001'

afterEach(async () => {
  closeTenantDb(T)
  await Dexie.delete(tenantDbName(T))
})

describe('pos/data/counter.repo (atomic local_counter)', () => {
  it('generates 1..50 without gaps under 50 parallel rw transactions', async () => {
    const db = await openTenantDb(T)
    const key = invoiceCounterKey('reg-01', '1126')

    expect(creditNoteCounterKey('reg-01', '1126')).toBe('reg-01|CREDIT_NOTE|1126')
    expect(billSeqCounterKey('bill-1')).toBe('bill-1|bill_seq')
    expect(DEVICE_SEQ_KEY).toBe('device_seq')

    const allocated = await Promise.all(
      Array.from({ length: 50 }, (_, idx) =>
        db.transaction('rw', db.local_counter, async (tx) => {
          return nextSeq(tx, key, {
            registerId: 'reg-01',
            docType: 'INVOICE',
            period: '1126',
            updatedAt: `2026-11-20T01:00:${String(idx % 60).padStart(2, '0')}.000Z`,
          })
        }),
      ),
    )

    const sorted = [...allocated].sort((a, b) => a - b)
    expect(sorted).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
    expect(await peekSeq(db, key)).toBe(50)
  })

  it('does not consume numbers when the enclosing transaction aborts', async () => {
    const db = await openTenantDb(T)
    const key = invoiceCounterKey('reg-02', '1126')

    const seq1 = await db.transaction('rw', db.local_counter, (tx) => nextSeq(tx, key))
    expect(seq1).toBe(1)

    await expect(
      db.transaction('rw', db.local_counter, async (tx) => {
        const provisional = await nextSeq(tx, key)
        expect(provisional).toBe(2)
        throw new Error('simulated crash before commit')
      }),
    ).rejects.toThrow('simulated crash before commit')

    // Next committed transaction must receive 2 cleanly without a gap.
    const seqAfterAbort = await db.transaction('rw', db.local_counter, (tx) => nextSeq(tx, key))
    expect(seqAfterAbort).toBe(2)
    expect(await peekSeq(db, key)).toBe(2)
  })

  it('demonstrates that awaiting a macrotask timer inside an IDB transaction causes premature auto-commit (AD-14 warning)', async () => {
    const db = await openTenantDb(T)
    const key = DEVICE_SEQ_KEY

    await expect(
      db.transaction('rw', db.local_counter, async (tx) => {
        await nextSeq(tx, key)
        // Forbidden non-IDB await pauses longer than the microtask queue so IDB auto-commits.
        await new Promise((resolve) => setTimeout(resolve, 15))
        return nextSeq(tx, key)
      }),
    ).rejects.toThrow()
  })
})
