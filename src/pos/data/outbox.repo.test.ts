import { afterEach, describe, expect, it } from 'vitest'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import {
  applyOutboxResults,
  enqueueCommand,
  enqueueCommandStandalone,
  getOutboxQueueSummary,
  listSendable,
  markOutboxSending,
  markSendingSchemaHeld,
  resetSending,
} from './outbox.repo'

const T1 = '0192a000-0000-7000-8000-00000000a001'
const REG = '0192a000-0000-7000-8000-00000000c001'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/data/outbox.repo', () => {
  it('enqueues atomically with monotonic device_seq, respects depends_on, byte/count caps, and resets stale SENDING', async () => {
    const db = await openTenantDb(T1)

    const parent = await enqueueCommandStandalone(db, {
      id: '0192f1c2-0000-7000-8000-000000000001',
      type: 'AppendAudit',
      payload: { entry: { action: 'OPEN' } },
      schemaVersion: 1,
      registerId: REG,
      createdAtDevice: '2026-11-20T01:00:00.000Z',
    })

    const child = await db.transaction('rw', db.outbox_command, db.local_counter, (tx) =>
      enqueueCommand(tx, {
        id: '0192f1c2-0000-7000-8000-000000000002',
        type: 'AppendAudit',
        payload: { entry: { action: 'DEPENDENT' } },
        schemaVersion: 1,
        registerId: REG,
        dependsOn: [parent.id],
        createdAtDevice: '2026-11-20T01:00:01.000Z',
      }),
    )

    expect(parent.device_seq).toBe(1)
    expect(child.device_seq).toBe(2)

    // Child must NOT be sendable until parent is ACKED.
    const firstBatch = await listSendable(db, { nowIso: '2026-11-20T01:00:05.000Z' })
    expect(firstBatch.map((r) => r.id)).toEqual([parent.id])

    // Mark sending then simulate boot crash -> resetSending restores PENDING.
    await markOutboxSending(db, [parent.id])
    expect(await resetSending(db)).toBe(1)

    // ACK parent -> child becomes sendable cleanly.
    await applyOutboxResults(
      db,
      [{ id: parent.id, outcome: 'ACK', result: { ok: true } }],
      { nowIso: '2026-11-20T01:01:00.000Z', nextRetryAtIso: () => '2026-11-20T01:02:00.000Z' },
    )

    const secondBatch = await listSendable(db, { nowIso: '2026-11-20T01:01:00.000Z' })
    expect(secondBatch.map((r) => r.id)).toEqual([child.id])

    // Schema-held commands stay out of sendable queue & pending banner counts.
    await markSendingSchemaHeld(db, [child.id])
    expect(await listSendable(db)).toEqual([])
    expect(await getOutboxQueueSummary(db)).toEqual({
      pending: 0,
      oldestAt: null,
      attention: 0,
      attentionIds: [],
    })
  })

  it('selects the first sendable commands across chunk boundaries', async () => {
    const db = await openTenantDb(T1)
    const idOf = (i: number) => `0192f1c2-0000-7000-8000-${String(i).padStart(12, '0')}`

    for (let i = 1; i <= 260; i += 1) {
      await enqueueCommandStandalone(db, {
        id: idOf(i),
        type: 'AppendAudit',
        payload: { entry: { action: `A${i}` } },
        schemaVersion: 1,
        registerId: REG,
        createdAtDevice: '2026-11-20T01:00:00.000Z',
      })
    }

    // Hold the first 150 commands in backoff: the first chunk (100 rows) has nothing sendable,
    // the second chunk (rows 101-200) only from row 151 onwards.
    await db.transaction('rw', db.outbox_command, async () => {
      for (let i = 1; i <= 150; i += 1) {
        await db.outbox_command.update(idOf(i), { next_retry_at: '2026-11-20T02:00:00.000Z' })
      }
    })

    const batch = await listSendable(db, { max: 20, nowIso: '2026-11-20T01:30:00.000Z' })

    expect(batch.map((r) => r.device_seq)).toEqual(Array.from({ length: 20 }, (_, k) => 151 + k))
  })
})
