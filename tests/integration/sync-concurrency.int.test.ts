import { sql } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  __resetForTests,
  pullPage,
  registerFeedSource,
  startPullCycle,
  writeMaster,
  type FeedCursor,
  type FeedRow,
  type FeedScope,
  type FeedSource,
} from '~/modules/sync/public'
import { closePools, withTenant } from '~/server/db'
import { classifyError } from '~/server/error-classify'
import { appClient, ownerClient, withClient } from './helpers/db'
import { createTestTenant, uniqueSlug, withTestTenant } from './helpers/tenants'

function createPrng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

const TestPaymentMethodFeed: FeedSource = {
  entity: 'payment_method',
  async selectKeys(tx, { after, upper, limit }) {
    const afterVer = after?.version ?? 0
    const afterId = after?.id ?? '00000000-0000-0000-0000-000000000000'
    const res = await tx.execute(sql`
      SELECT id, version
      FROM payment_method
      WHERE version <= ${upper}
        AND (
          version > ${afterVer}
          OR (version = ${afterVer} AND id > ${afterId}::uuid)
        )
      ORDER BY version ASC, id ASC
      LIMIT ${limit}
    `)
    return res.rows.map((r) => ({
      entity: 'payment_method',
      version: Number((r as { version: unknown }).version),
      id: String((r as { id: unknown }).id).toLowerCase(),
    }))
  },
  async hydrate(tx, ids) {
    if (ids.length === 0) return []
    const idList = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )
    const res = await tx.execute(sql`
      SELECT id, version, code, name, deleted_at
      FROM payment_method
      WHERE id IN (${idList})
      ORDER BY version ASC, id ASC
    `)
    return res.rows.map((r): FeedRow => {
      const row = r as {
        id: unknown
        version: unknown
        code: unknown
        name: unknown
        deleted_at: unknown
      }
      const id = String(row.id).toLowerCase()
      const version = Number(row.version)
      if (row.deleted_at !== null && row.deleted_at !== undefined) {
        return { entity: 'payment_method', op: 'delete', id, version }
      }
      return {
        entity: 'payment_method',
        op: 'upsert',
        id,
        version,
        row: { id, version, code: row.code, name: row.name },
      }
    })
  },
  async snapshotPage() {
    return []
  },
  async count() {
    return 0
  },
}

const DUMMY_SCOPE = (tenantId: string): FeedScope => ({
  tenantId,
  outletId: tenantId,
  registerId: tenantId,
  deviceId: tenantId,
})

describe('sync concurrency and gapless pull feed guarantees', () => {
  afterEach(() => {
    __resetForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('produces consecutive versions without gaps across N=12 parallel writers', async () => {
    const t = await createTestTenant(uniqueSlug('conc'))
    const workerCount = 12
    const ids: string[] = []

    // Seed 12 distinct rows in initial batch
    await withTestTenant(t.id, async (tx) => {
      await writeMaster(tx, { actorUserId: null }, async (w) => {
        for (let i = 0; i < workerCount; i += 1) {
          const code = `INIT_${i}`
          const inserted = await tx.execute(sql`
            INSERT INTO payment_method (tenant_id, version, code, name, kind)
            VALUES (${w.tenantId}::uuid, ${w.version}, ${code}, ${code}, 'NON_CASH')
            RETURNING id
          `)
          ids.push(String((inserted.rows[0] as { id: unknown }).id))
        }
      })
    })

    const v0 = 2

    await Promise.all(
      ids.map((id, idx) =>
        withTestTenant(t.id, async (tx) => {
          await writeMaster(tx, { actorUserId: null }, async (w) => {
            await tx.execute(sql`
              UPDATE payment_method
              SET name = ${`Updated ${idx}`}, version = ${w.version}, updated_at = now()
              WHERE id = ${id}::uuid
            `)
            await tx.execute(sql`
              INSERT INTO payment_method (tenant_id, version, code, name, kind)
              VALUES (${w.tenantId}::uuid, ${w.version}, ${`NEW_${idx}`}, ${`New ${idx}`}, 'NON_CASH')
            `)
          })
        }),
      ),
    )

    await withTestTenant(t.id, async (tx) => {
      const syncRes = await tx.execute(sql`SELECT version FROM tenant_sync`)
      expect(syncRes.rows[0]).toMatchObject({ version: v0 + workerCount })

      const distinctRes = await tx.execute(
        sql`SELECT DISTINCT version FROM payment_method WHERE version > ${v0} ORDER BY version ASC`,
      )
      const versions = distinctRes.rows.map((r) => Number((r as { version: unknown }).version))
      expect(versions).toEqual(Array.from({ length: workerCount }, (_, i) => v0 + i + 1))
    })
  })

  it('never misses a row update when 6 random writers race 3 polling readers', async () => {
    const seed = 20261119
    const rand = createPrng(seed)
    const t = await createTestTenant(uniqueSlug('race'))
    registerFeedSource(TestPaymentMethodFeed)

    let writersDone = false
    const writerCount = 6
    const writesPerWriter = 7 // 42 concurrent write transactions

    const writersPromise = Promise.all(
      Array.from({ length: writerCount }, async (_, wIdx) => {
        const ownIds: string[] = []
        for (let step = 0; step < writesPerWriter; step += 1) {
          const delayMs = Math.floor(rand() * 16)
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs))
          }
          const batchSize = 1 + Math.floor(rand() * 3)
          await withTestTenant(t.id, async (tx) => {
            await writeMaster(tx, { actorUserId: null }, async (w) => {
              for (let k = 0; k < batchSize; k += 1) {
                if (ownIds.length > 0 && rand() < 0.45) {
                  const targetId = ownIds[Math.floor(rand() * ownIds.length)]!
                  await tx.execute(sql`
                    UPDATE payment_method
                    SET name = ${`W${wIdx}_S${step}_K${k}`}, version = ${w.version}
                    WHERE id = ${targetId}::uuid
                  `)
                } else {
                  const code = `W${wIdx}_${step}_${k}`
                  const res = await tx.execute(sql`
                    INSERT INTO payment_method (tenant_id, version, code, name, kind)
                    VALUES (${w.tenantId}::uuid, ${w.version}, ${code}, ${code}, 'NON_CASH')
                    RETURNING id
                  `)
                  ownIds.push(String((res.rows[0] as { id: unknown }).id).toLowerCase())
                }
              }
            })
          })
        }
      }),
    ).finally(() => {
      writersDone = true
    })

    const drainPoll = async (
      seen: Map<string, number>,
      startCursor: FeedCursor | null,
    ): Promise<FeedCursor | null> => {
      let cursor = startCursor
      const cycle = await startPullCycle(t.id)
      while (true) {
        const page = await pullPage({
          tenantId: t.id,
          scope: DUMMY_SCOPE(t.id),
          cursor,
          cycleUpper: cycle.upper,
          pageSize: 7,
        })
        if (page.fullResyncRequired) {
          throw new Error(`Unexpected full resync required (seed=${seed})`)
        }
        for (const row of page.rows) {
          const prev = seen.get(row.id) ?? 0
          if (row.version > prev) {
            seen.set(row.id, row.version)
          }
        }
        cursor = page.nextCursor
        if (!page.hasMore) break
      }
      return cursor
    }

    const pollersPromise = Promise.all(
      Array.from({ length: 3 }, async () => {
        const seen = new Map<string, number>()
        let cursor: FeedCursor | null = null
        while (!writersDone) {
          cursor = await drainPoll(seen, cursor)
          await new Promise((resolve) => setTimeout(resolve, 4))
        }
        // Final catch-up pull after all writers finish
        await drainPoll(seen, cursor)
        return seen
      }),
    )

    await writersPromise
    const pollerViews = await pollersPromise

    await withTestTenant(t.id, async (tx) => {
      const dbRows = await tx.execute(sql`SELECT id, version FROM payment_method`)
      expect(dbRows.rows.length).toBeGreaterThanOrEqual(30)

      for (const seen of pollerViews) {
        for (const r of dbRows.rows) {
          const id = String((r as { id: unknown }).id).toLowerCase()
          const dbVersion = Number((r as { version: unknown }).version)
          const seenVersion = seen.get(id) ?? 0
          expect(
            seenVersion,
            `Row ${id} missed or stale in poller (seed=${seed}): seen=${seenVersion}, db=${dbVersion}`,
          ).toBeGreaterThanOrEqual(dbVersion)
        }
      }
    })
  })

  it('includes tombstones as op=delete and triggers CURSOR_BELOW_FLOOR when behind floor', async () => {
    const t = await createTestTenant(uniqueSlug('tomb'))
    registerFeedSource(TestPaymentMethodFeed)

    let deletedId = ''
    await withTestTenant(t.id, async (tx) => {
      await writeMaster(tx, { actorUserId: null }, async (w) => {
        const res = await tx.execute(sql`
          INSERT INTO payment_method (tenant_id, version, code, name, kind)
          VALUES (${w.tenantId}::uuid, ${w.version}, 'DEL1', 'To Delete', 'NON_CASH')
          RETURNING id
        `)
        deletedId = String((res.rows[0] as { id: unknown }).id).toLowerCase()
      })
    })

    await withTestTenant(t.id, async (tx) => {
      await writeMaster(tx, { actorUserId: null }, async (w) => {
        await tx.execute(sql`
          UPDATE payment_method
          SET deleted_at = now(), version = ${w.version}
          WHERE id = ${deletedId}::uuid
        `)
      })
    })

    const p1 = await pullPage({
      tenantId: t.id,
      scope: DUMMY_SCOPE(t.id),
      cursor: null,
      cycleUpper: null,
      pageSize: 50,
    })
    expect(p1.fullResyncRequired).toBe(false)
    if (!p1.fullResyncRequired) {
      expect(p1.rows).toEqual([
        { entity: 'payment_method', op: 'delete', id: deletedId, version: 3 },
      ])
    }

    // Advance tombstone_floor_version past cursor.version = 2
    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [t.id])
      await client.query(
        'UPDATE tenant_sync SET tombstone_floor_version = 3 WHERE tenant_id = $1',
        [t.id],
      )
      await client.query('COMMIT')
    })

    const p2 = await pullPage({
      tenantId: t.id,
      scope: DUMMY_SCOPE(t.id),
      cursor: { version: 2, id: deletedId },
      cycleUpper: null,
      pageSize: 50,
    })
    expect(p2).toEqual({ fullResyncRequired: true, reason: 'CURSOR_BELOW_FLOOR' })
  })

  it('classifies lock_timeout 55P03 on tenant_sync contention as retriable DB_UNAVAILABLE', async () => {
    const t = await createTestTenant(uniqueSlug('lock'))

    await withClient(appClient, async (holder) => {
      await holder.query('BEGIN')
      try {
        await holder.query("SELECT set_config('app.tenant_id', $1, true)", [t.id])
        await holder.query('SELECT version FROM tenant_sync WHERE tenant_id = $1 FOR UPDATE', [t.id])

        let caught: unknown
        try {
          await withTenant(
            t.id,
            async (tx) => {
              await writeMaster(tx, { actorUserId: null }, async () => 'blocked')
            },
            { lockTimeoutMs: 200 },
          )
        } catch (err) {
          caught = err
        }

        expect(caught).toBeDefined()
        expect(caught).toMatchObject({ cause: { code: '55P03' } })
        const classified = classifyError(caught)
        expect(classified.code).toBe('DB_UNAVAILABLE')
        expect(classified.retriable).toBe(true)
        expect(classified.status).toBe(503)
      } finally {
        await holder.query('ROLLBACK')
      }
    })
  })
})
