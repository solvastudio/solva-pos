import { webcrypto } from 'node:crypto'
import { createIdGenerator } from '~/lib/kernel'
import { withTenant, type TenantTx, type TxOptions } from '~/server/db'
import { ownerClient, withClient } from './db'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

export function uniqueSlug(prefix = 't'): string {
  const suffix = testIdGen.newId().slice(-8)
  return `${prefix}-${suffix}`
}

export async function createTestTenant(
  slug: string,
  name = slug,
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE',
): Promise<{ id: string; slug: string }> {
  const id = testIdGen.newId()

  await withClient(ownerClient, async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [id])
      await client.query(
        'INSERT INTO tenant (id, name, slug, status, version) VALUES ($1, $2, $3, $4, 1)',
        [id, name, slug, status],
      )
      await client.query('INSERT INTO tenant_sync (tenant_id, version) VALUES ($1, 1)', [id])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })

  return { id, slug }
}

export function withTestTenant<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  opts?: TxOptions,
): Promise<T> {
  return withTenant(tenantId, fn, opts)
}
