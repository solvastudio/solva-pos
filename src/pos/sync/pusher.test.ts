import { afterEach, describe, expect, it, vi } from 'vitest'
import { setMeta } from '../data/meta.repo'
import { enqueueCommandStandalone, getOutboxQueueSummary } from '../data/outbox.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { createSyncClock } from './clock'
import { runPush } from './pusher'

const T1 = '0192a000-0000-7000-8000-00000000a001'
const OUT_1 = '0192a000-0000-7000-8000-00000000b001'
const REG_1 = '0192a000-0000-7000-8000-00000000c001'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

async function setupWithDevice() {
  const db = await openTenantDb(T1)
  await setMeta(db, 'device', {
    device_id: 'dev-1',
    credential: 'cred-1',
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant_id: T1,
    slug: 'acme',
    register_id: REG_1,
    outlet_id: OUT_1,
    register_type: 'CASHIER',
  })
  return db
}

describe('pos/sync/pusher', () => {
  it('applies ACK, ATTENTION, RETRY, HELD cleanly and distinguishes push_ok', async () => {
    const db = await setupWithDevice()
    const clock = createSyncClock({
      db,
      nowMs: () => Date.UTC(2026, 10, 20, 7, 0, 0),
    })

    const c1 = await enqueueCommandStandalone(db, {
      id: '0192f1c2-0000-7000-8000-000000000011',
      type: 'AppendAudit',
      payload: { entry: { a: 1 } },
      schemaVersion: 1,
      registerId: REG_1,
      createdAtDevice: '2026-11-20T06:50:00.000Z',
    })
    const c2 = await enqueueCommandStandalone(db, {
      id: '0192f1c2-0000-7000-8000-000000000012',
      type: 'AppendAudit',
      payload: { entry: { a: 2 } },
      schemaVersion: 1,
      registerId: REG_1,
      createdAtDevice: '2026-11-20T06:51:00.000Z',
    })
    const c3 = await enqueueCommandStandalone(db, {
      id: '0192f1c2-0000-7000-8000-000000000013',
      type: 'AppendAudit',
      payload: { entry: { a: 3 } },
      schemaVersion: 1,
      registerId: REG_1,
      createdAtDevice: '2026-11-20T06:52:00.000Z',
    })
    const c4 = await enqueueCommandStandalone(db, {
      id: '0192f1c2-0000-7000-8000-000000000014',
      type: 'AppendAudit',
      payload: { entry: { a: 4 } },
      schemaVersion: 1,
      registerId: REG_1,
      createdAtDevice: '2026-11-20T06:53:00.000Z',
    })

    const res = await runPush({
      db,
      clock,
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            server_time: '2026-11-20T07:00:00.000Z',
            results: [
              { id: c1.id, outcome: 'ACK', result: {} },
              {
                id: c2.id,
                outcome: 'ATTENTION',
                reason_class: 'STRUCTURAL',
                reason_code: 'VALIDATION_FAILED',
                ref: 'ref-2',
              },
              { id: c3.id, outcome: 'RETRY' },
              { id: c4.id, outcome: 'HELD' },
            ],
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    })

    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') {
      expect(res.pushOk).toBe(false)
      expect(res.sentCount).toBe(4)
    }

    const summary = await getOutboxQueueSummary(db)
    expect(summary).toEqual({
      pending: 2, // c3 RETRY + c4 HELD
      oldestAt: '2026-11-20T06:52:00.000Z',
      attention: 1,
      attentionIds: [c2.id],
    })
  })

  it('does not increment attempts on 429 and marks SCHEMA-held on 426 without setting NEEDS_ATTENTION', async () => {
    const db = await setupWithDevice()
    const clock = createSyncClock({
      db,
      nowMs: () => Date.UTC(2026, 10, 20, 7, 0, 0),
    })

    const cmd = await enqueueCommandStandalone(db, {
      id: '0192f1c2-0000-7000-8000-000000000021',
      type: 'AppendAudit',
      payload: { entry: { a: 1 } },
      schemaVersion: 1,
      registerId: REG_1,
      createdAtDevice: '2026-11-20T06:50:00.000Z',
    })

    const rl = await runPush({
      db,
      clock,
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response('{}', { status: 429, headers: { 'Retry-After': '10' } }),
        ) as unknown as typeof fetch,
    })
    expect(rl.kind).toBe('rate_limited')
    const after429 = await db.outbox_command.get(cmd.id)
    expect(after429?.status).toBe('PENDING')
    expect(after429?.attempts).toBe(0)

    // Clear retry window for 426 check
    await db.outbox_command.update(cmd.id, { next_retry_at: null })

    const upd = await runPush({
      db,
      clock,
      fetch: vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ release: null }), { status: 426 })) as unknown as typeof fetch,
    })
    expect(upd).toEqual({ kind: 'update_required' })
    const after426 = await db.outbox_command.get(cmd.id)
    expect(after426?.status).toBe('PENDING')
    expect(after426?.last_error_class).toBe('SCHEMA')
  })
})
