import { adminClient, withClient } from './helpers/db'
import { assertAllTenantTablesProtected } from './helpers/rls-catalog'
import { describe, expect, it } from 'vitest'

describe('pg RLS catalog guard', () => {
  it('ensures every tenant-scoped table has ENABLE + FORCE RLS and >= 1 policy', async () => {
    await withClient(adminClient, async (client) => {
      const count = await assertAllTenantTablesProtected(client)
      expect(count).toBeGreaterThanOrEqual(2)
    })
  })
})
