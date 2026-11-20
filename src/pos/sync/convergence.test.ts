import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { enqueueCommandStandalone, getOutboxQueueSummary } from '../data/outbox.repo'
import { setMeta } from '../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb, type SolvaDb } from '../db/solva-db'
import { createSyncClock } from './clock'
import { runPush } from './pusher'

const TENANT_ID = '01950000-0000-7000-8000-000000000055'
let openedDb: SolvaDb | null = null

afterEach(async () => {
  if (openedDb) {
    openedDb.close()
    openedDb = null
  }
  await deleteTenantDbForTests(TENANT_ID)
})

describe('client-server convergence under simulated faults', () => {
  it('converges dependent commands across shuffled/transient/429 failures with zero duplicate server commits', async () => {
    openedDb = await openTenantDb(TENANT_ID)
    const db = openedDb

    await setMeta(db, 'device', {
      device_id: 'dev-conv-1',
      credential: 'tok-conv',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: TENANT_ID,
      slug: 'kopi',
      register_id: 'reg-01',
      outlet_id: 'out-01',
      register_type: 'CASHIER',
    })

    const shiftCmd = await enqueueCommandStandalone(db, {
      type: 'OpenShift',
      payload: { shift: { id: 'sh-1' } },
      schemaVersion: 1,
      registerId: 'reg-01',
      createdAtDevice: '2026-11-20T01:00:00.000Z',
    })
    const sale1Cmd = await enqueueCommandStandalone(db, {
      type: 'FinalizeSale',
      payload: { sale: { id: 'sale-1' } },
      schemaVersion: 1,
      registerId: 'reg-01',
      dependsOn: [shiftCmd.id],
      createdAtDevice: '2026-11-20T01:01:00.000Z',
    })
    const sale2Cmd = await enqueueCommandStandalone(db, {
      type: 'FinalizeSale',
      payload: { sale: { id: 'sale-2' } },
      schemaVersion: 1,
      registerId: 'reg-01',
      dependsOn: [shiftCmd.id],
      createdAtDevice: '2026-11-20T01:02:00.000Z',
    })

    const committedOnServer = new Map<string, number>()
    let callIdx = 0
    const wallNowMs = Date.now()
    let fakeNowMs = wallNowMs
    let fakePerfMs = 1_000
    const clock = createSyncClock({
      db,
      nowMs: () => fakeNowMs,
      perfNow: () => fakePerfMs,
    })

    const flakyServerFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      callIdx += 1
      const reqBody = JSON.parse(String(init?.body ?? '{}')) as {
        commands: Array<{ id: string; depends_on: string[] }>
      }

      // Cycle 1: 429 rate limited
      if (callIdx === 1) {
        return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', ref: 'rl-1' } }), {
          status: 429,
          headers: { 'Retry-After': '5' },
        })
      }
      // Cycle 2: transient 503 after accepting nothing
      if (callIdx === 2) {
        return new Response(JSON.stringify({ error: { code: 'DB_UNAVAILABLE', ref: 'db-1' } }), {
          status: 503,
        })
      }

      // Process commands idempotently; force RETRY once on first encounter of sale2Cmd
      const results = reqBody.commands
        .slice()
        .reverse() // Reverse / shuffle response ordering!
        .map((c) => {
          if (c.depends_on.some((dep) => !committedOnServer.has(dep))) {
            return { id: c.id, outcome: 'HELD' as const }
          }
          if (c.id === sale2Cmd.id && !committedOnServer.has(c.id) && callIdx === 4) {
            return { id: c.id, outcome: 'RETRY' as const }
          }
          committedOnServer.set(c.id, (committedOnServer.get(c.id) ?? 0) + 1)
          return {
            id: c.id,
            outcome: 'ACK' as const,
            result: { received_at: new Date(wallNowMs).toISOString(), flags: [] },
          }
        })

      return new Response(
        JSON.stringify({
          server_time: new Date(wallNowMs).toISOString(),
          results,
          max_schema_version: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    for (let round = 0; round < 10; round += 1) {
      await runPush({ db, clock, fetch: flakyServerFetch })
      fakeNowMs += 600_000 // Advance both wall and monotonic clocks past backoff windows
      fakePerfMs += 600_000
      const summary = await getOutboxQueueSummary(db)
      if (summary.pending === 0 && summary.attention === 0) break
    }

    const finalSummary = await getOutboxQueueSummary(db)
    expect(finalSummary.pending).toBe(0)
    expect(finalSummary.attention).toBe(0)

    // Each command executed at most once in the authoritative server state
    expect(committedOnServer.get(shiftCmd.id)).toBe(1)
    expect(committedOnServer.get(sale1Cmd.id)).toBe(1)
    expect(committedOnServer.get(sale2Cmd.id)).toBe(1)
  })
})
