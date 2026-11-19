import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { subscribeMasterChanged, writeMaster } from '~/modules/sync/public'
import { closePools, registerAfterCommit, withTenant } from '~/server/db'
import { createTestTenant, uniqueSlug, withTestTenant } from './helpers/tenants'

describe('sync.writeMaster and master_version_guard', () => {
  afterAll(async () => {
    await closePools()
  })

  it('bumps tenant_sync.version by +1 and passes matching w.version', async () => {
    const t = await createTestTenant(uniqueSlug('wm1'))

    const res = await withTestTenant(t.id, async (tx) => {
      return writeMaster(tx, { actorUserId: null }, async (w) => {
        expect(w.tenantId).toBe(t.id)
        expect(w.version).toBe(2)

        await tx.execute(
          sql`INSERT INTO payment_method (tenant_id, version, code, name, kind)
              VALUES (${w.tenantId}::uuid, ${w.version}, 'QRIS', 'QRIS', 'NON_CASH')`,
        )
        return 'created'
      })
    })

    expect(res).toEqual({ result: 'created', version: 2 })

    await withTestTenant(t.id, async (tx) => {
      const check = await tx.execute(sql`SELECT version FROM tenant_sync`)
      expect(check.rows[0]).toMatchObject({ version: 2 })
    })
  })

  it('rejects inserts or updates whose version does not match tenant_sync.version', async () => {
    const t = await createTestTenant(uniqueSlug('wm2'))

    // Initial tenant_sync.version is 1, so version 999 fails trigger guard
    await expect(
      withTestTenant(t.id, async (tx) => {
        await tx.execute(
          sql`INSERT INTO payment_method (tenant_id, version, code, name, kind)
              VALUES (${t.id}::uuid, 999, 'BAD1', 'Bad Version', 'NON_CASH')`,
        )
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/does not match tenant_sync version/) },
    })

    // Create row via writeMaster (version -> 2), then try updating without bumping version (remains 2, writeMaster not called -> attempt version 1 fails)
    await withTestTenant(t.id, async (tx) => {
      await writeMaster(tx, { actorUserId: null }, async (w) => {
        await tx.execute(
          sql`INSERT INTO payment_method (tenant_id, version, code, name, kind)
              VALUES (${w.tenantId}::uuid, ${w.version}, 'QRIS', 'QRIS', 'NON_CASH')`,
        )
      })
    })

    // Bump version to 3 via another writeMaster so previous version 2 is now stale
    await withTestTenant(t.id, async (tx) => {
      await writeMaster(tx, { actorUserId: null }, async (w) => {
        await tx.execute(
          sql`INSERT INTO payment_method (tenant_id, version, code, name, kind)
              VALUES (${w.tenantId}::uuid, ${w.version}, 'CARD', 'Card', 'NON_CASH')`,
        )
      })
    })

    await expect(
      withTestTenant(t.id, async (tx) => {
        await tx.execute(
          sql`UPDATE payment_method SET name = 'Stale Edit', version = 2 WHERE code = 'QRIS'`,
        )
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/does not match tenant_sync version/) },
    })
  })

  it('rejects calling writeMaster twice in the same transaction', async () => {
    const t = await createTestTenant(uniqueSlug('wm3'))

    await expect(
      withTestTenant(t.id, async (tx) => {
        await writeMaster(tx, { actorUserId: null }, async () => 'first')
        await writeMaster(tx, { actorUserId: null }, async () => 'second')
      }),
    ).rejects.toThrowError(/writeMaster called twice/)
  })

  it('rolls back tenant_sync.version when callback throws (no version gap)', async () => {
    const t = await createTestTenant(uniqueSlug('wm4'))

    await expect(
      withTestTenant(t.id, async (tx) => {
        await writeMaster(tx, { actorUserId: null }, async () => {
          throw new Error('simulated failure')
        })
      }),
    ).rejects.toThrowError('simulated failure')

    await withTestTenant(t.id, async (tx) => {
      const check = await tx.execute(sql`SELECT version FROM tenant_sync`)
      expect(check.rows[0]).toMatchObject({ version: 1 })
    })
  })

  it('invokes after-commit callbacks once on commit and never on rollback', async () => {
    const t = await createTestTenant(uniqueSlug('wm5'))
    const signals: number[] = []
    let hookCalls = 0

    const unsub = subscribeMasterChanged(t.id, (v) => {
      signals.push(v)
    })

    try {
      await expect(
        withTestTenant(t.id, async (tx) => {
          registerAfterCommit(tx, () => {
            hookCalls += 1
          })
          await writeMaster(tx, { actorUserId: null }, async () => {
            throw new Error('abort tx')
          })
        }),
      ).rejects.toThrowError('abort tx')

      expect(hookCalls).toBe(0)
      expect(signals).toEqual([])

      await withTestTenant(t.id, async (tx) => {
        registerAfterCommit(tx, () => {
          hookCalls += 1
        })
        await writeMaster(tx, { actorUserId: null }, async () => 'committed')
      })

      expect(hookCalls).toBe(1)
      expect(signals).toEqual([2])
    } finally {
      unsub()
    }
  })

  it('prevents tenant A transaction context from bumping tenant B version', async () => {
    const tenantA = await createTestTenant(uniqueSlug('wma'))
    const tenantB = await createTestTenant(uniqueSlug('wmb'))

    await withTestTenant(tenantA.id, async (tx) => {
      await writeMaster(tx, { actorUserId: null }, async (w) => {
        expect(w.tenantId).toBe(tenantA.id)
      })
    })

    await withTestTenant(tenantB.id, async (tx) => {
      const res = await tx.execute(sql`SELECT version FROM tenant_sync`)
      expect(res.rows[0]).toMatchObject({ version: 1 })
    })
  })

  it('stamps 100 bulk-imported rows with a single version inside one writeMaster call', async () => {
    const t = await createTestTenant(uniqueSlug('wmbulk'))

    await withTenant(t.id, async (tx) => {
      await writeMaster(tx, { actorUserId: null }, async (w) => {
        for (let i = 0; i < 100; i += 1) {
          const code = `M_${String(i).padStart(3, '0')}`
          await tx.execute(
            sql`INSERT INTO payment_method (tenant_id, version, code, name, kind)
                VALUES (${w.tenantId}::uuid, ${w.version}, ${code}, ${code}, 'NON_CASH')`,
          )
        }
      })
    })

    await withTestTenant(t.id, async (tx) => {
      const res = await tx.execute(
        sql`SELECT count(*)::int AS cnt, count(DISTINCT version)::int AS versions, min(version) AS ver
            FROM payment_method`,
      )
      expect(res.rows[0]).toMatchObject({ cnt: 100, versions: 1, ver: 2 })
    })
  })
})
