import { describe, expect, it } from 'vitest'
import { PERMISSION_CODES, PERMISSION_DEFINITIONS } from '~/modules/identity/shared'
import { appClient, withClient } from './helpers/db'

describe('permission catalog seed and access control', () => {
  it('matches PERMISSION_CODES and PERMISSION_DEFINITIONS without tenant context', async () => {
    await withClient(appClient, async (client) => {
      const res = await client.query<{ code: string; module: string; description: string }>(
        'SELECT code, module, description FROM permission ORDER BY code',
      )
      expect(res.rows).toHaveLength(PERMISSION_CODES.length)
      expect(new Set(res.rows.map((r) => r.code))).toEqual(new Set(PERMISSION_CODES))

      const expectedByCode = new Map(PERMISSION_DEFINITIONS.map((d) => [d.code, d]))
      for (const row of res.rows) {
        const expected = expectedByCode.get(row.code as (typeof PERMISSION_CODES)[number])
        expect(expected).toBeDefined()
        expect(row.module).toBe(expected?.module)
        expect(row.description).toBe(expected?.description)
      }
    })
  })

  it('prevents solva_app_login from mutating permission catalog', async () => {
    await withClient(appClient, async (client) => {
      await expect(
        client.query(
          "INSERT INTO permission (code, module, description) VALUES ('fake.perm', 'sales', 'permission.fake.perm')",
        ),
      ).rejects.toMatchObject({ code: '42501' })

      await expect(
        client.query("UPDATE permission SET module = 'other' WHERE code = 'sale.create'"),
      ).rejects.toMatchObject({ code: '42501' })

      await expect(
        client.query("DELETE FROM permission WHERE code = 'sale.create'"),
      ).rejects.toMatchObject({ code: '42501' })
    })
  })
})
