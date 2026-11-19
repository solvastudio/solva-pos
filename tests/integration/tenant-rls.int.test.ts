import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closePools, withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { appClient, withClient } from './helpers/db'
import { createTestTenant, uniqueSlug, withTestTenant } from './helpers/tenants'

describe('tenant RLS isolation and withTenant context', () => {
  afterAll(async () => {
    await closePools()
  })

  it('returns 0 rows without error when app.tenant_id context is unset', async () => {
    await createTestTenant(uniqueSlug('unset'))
    await withClient(appClient, async (client) => {
      const res = await client.query<{ cnt: number }>('SELECT count(*)::int AS cnt FROM tenant')
      expect(res.rows[0]?.cnt).toBe(0)
    })
  })

  it('isolates reads and writes across tenants (0 rows leaked)', async () => {
    const tenantA = await createTestTenant(uniqueSlug('a'), 'Tenant A')
    const tenantB = await createTestTenant(uniqueSlug('b'), 'Tenant B')

    await withTestTenant(tenantA.id, async (tx) => {
      const visible = await tx.execute(sql`SELECT id, name FROM tenant`)
      expect(visible.rows).toHaveLength(1)
      expect(visible.rows[0]).toMatchObject({ id: tenantA.id, name: 'Tenant A' })

      const updatedOther = await tx.execute(
        sql`UPDATE tenant SET name = 'hijack' WHERE id = ${tenantB.id}::uuid`,
      )
      expect(updatedOther.rowCount).toBe(0)

      await expect(
        tx.execute(sql`INSERT INTO tenant_sync (tenant_id) VALUES (${tenantB.id}::uuid)`),
      ).rejects.toMatchObject({
        cause: {
          code: '42501',
          message: expect.stringMatching(/row-level security policy/i),
        },
      })
    })
  })

  it('keeps next transaction on the same connection safe when SET LOCAL expires', async () => {
    const tenantA = await createTestTenant(uniqueSlug('reuse'))

    await withClient(appClient, async (client) => {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA.id])
      const res1 = await client.query<{ cnt: number }>('SELECT count(*)::int AS cnt FROM tenant')
      expect(res1.rows[0]?.cnt).toBe(1)
      await client.query('COMMIT')

      await client.query('BEGIN')
      const res2 = await client.query<{ cnt: number }>('SELECT count(*)::int AS cnt FROM tenant')
      expect(res2.rows[0]?.cnt).toBe(0)
      await client.query('COMMIT')
    })
  })

  it('rejects non-UUID tenantId with AppError(FORBIDDEN) before opening a transaction', async () => {
    await expect(
      withTenant('not-a-uuid', async () => 'unreachable'),
    ).rejects.toSatisfy((err: unknown) => err instanceof AppError && err.code === 'FORBIDDEN')
  })

  it('applies default 15s statement_timeout and supports withTenantReadOnly', async () => {
    const tenantA = await createTestTenant(uniqueSlug('timeout'))

    const timeoutRes = await withTestTenant(tenantA.id, async (tx) => {
      const r = await tx.execute(sql`SHOW statement_timeout`)
      return r.rows[0] as { statement_timeout: string }
    })
    expect(timeoutRes.statement_timeout).toBe('15s')

    const readOnlyRows = await withTenantReadOnly(tenantA.id, async (tx) => {
      const r = await tx.execute(sql`SELECT tenant_id FROM tenant_sync`)
      return r.rows
    })
    expect(readOnlyRows).toHaveLength(1)
  })

  it('enforces table grants and isolates definer read policy from app role', async () => {
    const slugA = uniqueSlug('grants')
    await createTestTenant(slugA, 'Store Grants')

    await withClient(appClient, async (client) => {
      await expect(client.query('DELETE FROM tenant')).rejects.toMatchObject({ code: '42501' })

      const resolved = await client.query<{ id: string; status: string; name: string }>(
        'SELECT id, status, name FROM resolve_tenant_by_slug($1)',
        [slugA],
      )
      expect(resolved.rows).toHaveLength(1)

      const directRead = await client.query<{ cnt: number }>(
        'SELECT count(*)::int AS cnt FROM tenant',
      )
      expect(directRead.rows[0]?.cnt).toBe(0)
    })
  })
})
