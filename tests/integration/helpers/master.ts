import type { Client } from 'pg'
import { ownerClient, withClient } from './db'

export async function bumpMasterVersion(client: Client): Promise<number> {
  const res = await client.query<{ version: string | number }>(
    `UPDATE tenant_sync
     SET version = version + 1, updated_at = now()
     WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     RETURNING version`,
  )
  if (res.rows.length !== 1) {
    throw new Error('Failed to bump tenant_sync version: missing tenant context or row')
  }
  return Number(res.rows[0]!.version)
}

export async function masterTx<T>(
  tenantId: string,
  fn: (client: Client, version: number) => Promise<T>,
): Promise<T> {
  return withClient(ownerClient, async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      const version = await bumpMasterVersion(client)
      const result = await fn(client, version)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}
