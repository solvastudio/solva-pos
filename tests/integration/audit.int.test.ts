import { webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { verifyTenantsAudit } from '../../scripts/ops/verify-audit-chain'
import { createIdGenerator } from '~/lib/kernel'
import { appendAudit, verifyAuditChain } from '~/modules/audit/public'
import { GENESIS_HASH } from '~/modules/audit/server/audit.repo'
import { closePools, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { adminClient, appClient, ownerClient, withClient } from './helpers/db'
import { createTestTenant, uniqueSlug, withTestTenant } from './helpers/tenants'

const testIds = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

function makeDeps(baseIso = '2026-11-19T12:00:00.000Z') {
  let step = 0
  const baseMs = Date.parse(baseIso)
  return {
    newId: () => testIds.newId(),
    nowIso: () => {
      step += 1
      return new Date(baseMs + step * 1000).toISOString()
    },
  }
}

describe('audit log hash chain, verification, and immutability', () => {
  afterAll(async () => {
    await closePools()
  })

  it('builds a sequential hash chain anchored at GENESIS_HASH and verifies cleanly', async () => {
    const t = await createTestTenant(uniqueSlug('aud1'))
    const deps = makeDeps()

    const seqs: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const res = await withTestTenant(t.id, (tx) =>
        appendAudit(
          tx,
          {
            action: 'price.changed',
            entityType: 'price_entry',
            entityId: testIds.newId(),
            beforeData: { price: 10000 + i },
            afterData: { price: 12000 + i },
            occurredAt: '2026-11-19T12:00:00Z',
            reasonCode: 'MANUAL',
            reasonText: `Change ${i + 1}`,
          },
          deps,
        ),
      )
      seqs.push(res.chainSeq)
    }

    expect(seqs).toEqual([1, 2, 3, 4, 5])

    await withTestTenant(t.id, async (tx) => {
      const firstRes = await tx.execute(
        sql`SELECT prev_hash FROM audit_log WHERE chain_seq = 1`,
      )
      const prevHash = (firstRes.rows[0] as { prev_hash: Buffer }).prev_hash
      expect(Buffer.compare(prevHash, GENESIS_HASH)).toBe(0)

      const verified = await verifyAuditChain(tx)
      expect(verified).toEqual({ ok: true, checked: 5 })
    })
  })

  it('maintains a gapless chain across 12 parallel transactions', async () => {
    const t = await createTestTenant(uniqueSlug('audconc'))
    const deps = makeDeps()

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, idx) =>
        withTestTenant(t.id, (tx) =>
          appendAudit(
            tx,
            {
              action: 'outlet.changed',
              entityType: 'outlet',
              afterData: { step: idx },
              occurredAt: '2026-11-19T12:00:00.000Z',
            },
            deps,
          ),
        ),
      ),
    )

    const seqs = results.map((r) => r.chainSeq).sort((a, b) => a - b)
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

    await withTenantReadOnly(t.id, async (tx) => {
      expect(await verifyAuditChain(tx)).toEqual({ ok: true, checked: 12 })
    })
  })

  it('supports idempotent replay on duplicate input.id without advancing chain', async () => {
    const t = await createTestTenant(uniqueSlug('audrep'))
    const deps = makeDeps()
    const fixedId = testIds.newId()

    const first = await withTestTenant(t.id, (tx) =>
      appendAudit(
        tx,
        {
          id: fixedId,
          action: 'sale.void',
          entityType: 'sale',
          occurredAt: '2026-11-19T12:00:00.000Z',
        },
        deps,
      ),
    )
    expect(first).toEqual({ id: fixedId, chainSeq: 1, replay: false })

    const second = await withTestTenant(t.id, (tx) =>
      appendAudit(
        tx,
        {
          id: fixedId,
          action: 'sale.void',
          entityType: 'sale',
          occurredAt: '2026-11-19T12:00:00.000Z',
        },
        deps,
      ),
    )
    expect(second).toEqual({ id: fixedId, chainSeq: 1, replay: true })

    await withTenantReadOnly(t.id, async (tx) => {
      const cnt = await tx.execute(sql`SELECT count(*)::int AS cnt FROM audit_log`)
      expect(cnt.rows[0]).toMatchObject({ cnt: 1 })
      expect(await verifyAuditChain(tx)).toEqual({ ok: true, checked: 1 })
    })
  })

  it('leaves chain intact on transaction rollback with zero sequence gaps', async () => {
    const t = await createTestTenant(uniqueSlug('audrb'))
    const deps = makeDeps()

    await withTestTenant(t.id, (tx) =>
      appendAudit(
        tx,
        {
          action: 'drawer.opened',
          entityType: 'cash_master',
          occurredAt: '2026-11-19T12:00:00.000Z',
        },
        deps,
      ),
    )

    await expect(
      withTestTenant(t.id, async (tx) => {
        await appendAudit(
          tx,
          {
            action: 'drawer.opened',
            entityType: 'cash_master',
            occurredAt: '2026-11-19T12:00:01.000Z',
          },
          deps,
        )
        throw new Error('rollback business tx')
      }),
    ).rejects.toThrowError('rollback business tx')

    const next = await withTestTenant(t.id, (tx) =>
      appendAudit(
        tx,
        {
          action: 'drawer.opened',
          entityType: 'cash_master',
          occurredAt: '2026-11-19T12:00:02.000Z',
        },
        deps,
      ),
    )
    expect(next.chainSeq).toBe(2)

    await withTenantReadOnly(t.id, async (tx) => {
      expect(await verifyAuditChain(tx)).toEqual({ ok: true, checked: 2 })
    })
  })

  it('enforces multi-layered immutability for app role and table owner', async () => {
    const t = await createTestTenant(uniqueSlug('audimm'))
    const deps = makeDeps()

    await withTestTenant(t.id, (tx) =>
      appendAudit(
        tx,
        {
          action: 'role.changed',
          entityType: 'role',
          occurredAt: '2026-11-19T12:00:00.000Z',
          reasonText: 'Initial',
        },
        deps,
      ),
    )

    // App role lacks UPDATE, DELETE, and TRUNCATE privileges
    await withClient(appClient, async (client) => {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [t.id])
      await expect(
        client.query("UPDATE audit_log SET reason_text = 'hacked'"),
      ).rejects.toMatchObject({ code: '42501' })
      await client.query('ROLLBACK')

      await client.query('BEGIN')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [t.id])
      await expect(client.query('DELETE FROM audit_log')).rejects.toMatchObject({ code: '42501' })
      await client.query('ROLLBACK')

      await client.query('BEGIN')
      await expect(client.query('TRUNCATE audit_log')).rejects.toMatchObject({ code: '42501' })
      await client.query('ROLLBACK')
    })

    // Owner is blocked by append-only RLS (0 rows modifiable on UPDATE/DELETE) and BEFORE TRUNCATE trigger
    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [t.id])
      const upd = await client.query("UPDATE audit_log SET reason_text = 'owner edit'")
      expect(upd.rowCount).toBe(0)
      await expect(client.query('TRUNCATE audit_log')).rejects.toThrowError(/audit_log is append-only/)
      await client.query('ROLLBACK')
    })

    // Even superuser (bypassing RLS) hits the forbid_mutation BEFORE UPDATE/DELETE trigger
    await withClient(adminClient, async (client) => {
      await client.query('BEGIN')
      await expect(
        client.query("UPDATE audit_log SET reason_text = 'admin edit' WHERE tenant_id = $1", [t.id]),
      ).rejects.toThrowError(/audit_log is append-only/)
      await client.query('ROLLBACK')

      await client.query('BEGIN')
      await expect(
        client.query('DELETE FROM audit_log WHERE tenant_id = $1', [t.id]),
      ).rejects.toThrowError(/audit_log is append-only/)
      await client.query('ROLLBACK')
    })
  })

  it('detects row tampering via verifyAuditChain and verifyTenantsAudit CLI', async () => {
    const t = await createTestTenant(uniqueSlug('audtamper'))
    const deps = makeDeps()

    for (let i = 0; i < 3; i += 1) {
      await withTestTenant(t.id, (tx) =>
        appendAudit(
          tx,
          {
            action: 'cash.movement',
            entityType: 'cash_movement',
            occurredAt: '2026-11-19T12:00:00.000Z',
            reasonText: `Entry ${i + 1}`,
          },
          deps,
        ),
      )
    }

    expect(await verifyTenantsAudit([t.id])).toBe(true)

    // Simulate privileged DB tampering while trigger is temporarily disabled
    await withClient(adminClient, async (client) => {
      await client.query('BEGIN')
      await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable')
      await client.query(
        "UPDATE audit_log SET reason_text = 'tampered' WHERE tenant_id = $1 AND chain_seq = 2",
        [t.id],
      )
      await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable')
      await client.query('COMMIT')
    })

    await withTenantReadOnly(t.id, async (tx) => {
      expect(await verifyAuditChain(tx)).toEqual({
        ok: false,
        brokenAtSeq: 2,
        reason: 'ROW_HASH',
      })
    })
    expect(await verifyTenantsAudit([t.id])).toBe(false)
  })

  it('rejects sensitive keys and unknown actions, while accepting safe business payloads', async () => {
    const t = await createTestTenant(uniqueSlug('audred'))
    const deps = makeDeps()

    await expect(
      withTestTenant(t.id, (tx) =>
        appendAudit(
          tx,
          {
            action: 'user.changed',
            entityType: 'app_user',
            beforeData: { pin_hash: 'secret-hash' },
            occurredAt: '2026-11-19T12:00:00.000Z',
          },
          deps,
        ),
      ),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'VALIDATION_FAILED')

    await expect(
      withTestTenant(t.id, (tx) =>
        appendAudit(
          tx,
          {
            action: 'user.changed',
            entityType: 'app_user',
            afterData: { nested: { token: 'bearer-xyz' } },
            occurredAt: '2026-11-19T12:00:00.000Z',
          },
          deps,
        ),
      ),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'VALIDATION_FAILED')

    await expect(
      withTestTenant(t.id, (tx) =>
        appendAudit(
          tx,
          {
            action: 'foo.bar',
            entityType: 'unknown',
            occurredAt: '2026-11-19T12:00:00.000Z',
          },
          deps,
        ),
      ),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'VALIDATION_FAILED')

    const safe = await withTestTenant(t.id, (tx) =>
      appendAudit(
        tx,
        {
          action: 'price.changed',
          entityType: 'price_entry',
          afterData: { price: 19000 },
          occurredAt: '2026-11-19T12:00:00.000Z',
        },
        deps,
      ),
    )
    expect(safe.chainSeq).toBe(1)
  })

  it('isolates audit entries and maintains independent chain sequences per tenant', async () => {
    const tenantA = await createTestTenant(uniqueSlug('auda'))
    const tenantB = await createTestTenant(uniqueSlug('audb'))
    const deps = makeDeps()

    const bRes = await withTestTenant(tenantB.id, (tx) =>
      appendAudit(
        tx,
        {
          action: 'tenant.created',
          entityType: 'tenant',
          occurredAt: '2026-11-19T12:00:00.000Z',
        },
        deps,
      ),
    )
    expect(bRes.chainSeq).toBe(1)

    await withTestTenant(tenantA.id, async (tx) => {
      const cntRes = await tx.execute(sql`SELECT count(*)::int AS cnt FROM audit_log`)
      expect(cntRes.rows[0]).toMatchObject({ cnt: 0 })

      const aRes = await appendAudit(
        tx,
        {
          action: 'tenant.created',
          entityType: 'tenant',
          occurredAt: '2026-11-19T12:00:00.000Z',
        },
        deps,
      )
      expect(aRes.chainSeq).toBe(1)
    })
  })
})
