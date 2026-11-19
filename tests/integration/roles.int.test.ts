import { describe, expect, it } from 'vitest'
import { appClient, withClient } from './helpers/db'

describe('database roles and baseline migration', () => {
  it('verifies solva_app_login is non-superuser and has NOBYPASSRLS', async () => {
    await withClient(appClient, async (client) => {
      const res = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      )
      expect(res.rows).toHaveLength(1)
      expect(res.rows[0]?.rolsuper).toBe(false)
      expect(res.rows[0]?.rolbypassrls).toBe(false)
    })
  })

  it('verifies solva_app_login is a member of solva_app', async () => {
    await withClient(appClient, async (client) => {
      const res = await client.query<{ is_member: boolean }>(
        "SELECT pg_has_role('solva_app_login', 'solva_app', 'member') AS is_member",
      )
      expect(res.rows[0]?.is_member).toBe(true)
    })
  })

  it('sets session timezone to UTC for new connections to solva_test', async () => {
    await withClient(appClient, async (client) => {
      const res = await client.query<{ TimeZone: string }>('SHOW timezone')
      expect(res.rows[0]?.TimeZone).toBe('UTC')
    })
  })

  it('prevents solva_app_login from creating tables in public schema', async () => {
    await withClient(appClient, async (client) => {
      await expect(
        client.query('CREATE TABLE public.should_fail (id int)'),
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('installs the forbid_mutation() trigger function', async () => {
    await withClient(appClient, async (client) => {
      const res = await client.query<{ proname: string }>(
        "SELECT proname FROM pg_proc WHERE proname = 'forbid_mutation'",
      )
      expect(res.rows).toEqual([{ proname: 'forbid_mutation' }])
    })
  })
})
