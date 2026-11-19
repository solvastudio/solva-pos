import { afterAll, describe, expect, it } from 'vitest'
import { closePools } from '~/server/db'
import { appClient, ownerClient, withClient } from './helpers/db'
import { createTestTenant, uniqueSlug } from './helpers/tenants'

describe('tenant slug constraints, permanence trigger, and definer lookups', () => {
  afterAll(async () => {
    await closePools()
  })

  it('rejects invalid slugs via CHECK constraint', async () => {
    await expect(createTestTenant('Acme_1', 'Bad Uppercase')).rejects.toMatchObject({
      code: '23514',
    })
    await expect(createTestTenant('a'.repeat(31), 'Too Long')).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('enforces slug permanence trigger and uniqueness', async () => {
    const slug = uniqueSlug('perm')
    const created = await createTestTenant(slug, 'Original Store')

    await expect(createTestTenant(slug, 'Duplicate Store')).rejects.toMatchObject({
      code: '23505',
    })

    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [created.id])
        await expect(
          client.query('UPDATE tenant SET slug = $1 WHERE id = $2', [`${slug}-x`, created.id]),
        ).rejects.toThrowError(/tenant\.slug is permanent/)
      } finally {
        await client.query('ROLLBACK')
      }
    })
  })

  it('resolves tenant by slug case-insensitively without context and lists active tenants only', async () => {
    const activeSlug = uniqueSlug('active')
    const suspendedSlug = uniqueSlug('susp')
    const active = await createTestTenant(activeSlug, 'Active Store', 'ACTIVE')
    const suspended = await createTestTenant(suspendedSlug, 'Suspended Store', 'SUSPENDED')

    await withClient(appClient, async (client) => {
      const found = await client.query<{ id: string; status: string; name: string }>(
        'SELECT id, status, name FROM resolve_tenant_by_slug($1)',
        [activeSlug.toUpperCase()],
      )
      expect(found.rows).toEqual([
        { id: active.id, status: 'ACTIVE', name: 'Active Store' },
      ])
      expect(Object.keys(found.rows[0]!)).toEqual(['id', 'status', 'name'])

      const missing = await client.query(
        'SELECT id, status, name FROM resolve_tenant_by_slug($1)',
        [uniqueSlug('missing')],
      )
      expect(missing.rows).toHaveLength(0)

      const activeList = await client.query<{ id: string }>('SELECT id FROM list_active_tenants()')
      const ids = activeList.rows.map((r) => r.id)
      expect(ids).toContain(active.id)
      expect(ids).not.toContain(suspended.id)
    })
  })
})
