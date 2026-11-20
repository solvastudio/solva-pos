import { Client } from 'pg'
import { readE2eState } from './seed'

export async function withE2eOwnerClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const state = readE2eState()
  const client = new Client({ connectionString: state.e2eDbOwnerUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function withE2eAppLoginClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const state = readE2eState()
  const client = new Client({ connectionString: state.e2eDbAppUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function listAuditLogsByAction(
  tenantId: string,
  action: string,
  tag?: string,
): Promise<Array<{ id: string; entity_id: string | null; after_data: unknown }>> {
  return withE2eOwnerClient(async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      const res = tag
        ? await client.query<{
            id: string
            entity_id: string | null
            after_data: unknown
          }>(
            "SELECT id, entity_id, after_data FROM audit_log WHERE tenant_id = $1 AND action = $2 AND after_data->>'tag' = $3 ORDER BY chain_seq",
            [tenantId, action, tag],
          )
        : await client.query<{
            id: string
            entity_id: string | null
            after_data: unknown
          }>(
            'SELECT id, entity_id, after_data FROM audit_log WHERE tenant_id = $1 AND action = $2 ORDER BY chain_seq',
            [tenantId, action],
          )
      await client.query('COMMIT')
      return res.rows
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

export async function findIdempotencyCommands(
  tenantId: string,
  ids: readonly string[],
): Promise<
  Array<{
    id: string
    status: string
    app_version: string | null
    schema_version: number
    result: unknown
  }>
> {
  if (ids.length === 0) return []
  return withE2eOwnerClient(async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      const res = await client.query<{
        id: string
        status: string
        app_version: string | null
        schema_version: number
        result: unknown
      }>(
        'SELECT command_id AS id, status, app_version, schema_version, result FROM idempotency_command WHERE tenant_id = $1 AND command_id = ANY($2::uuid[])',
        [tenantId, ids],
      )
      await client.query('COMMIT')
      return res.rows
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

export async function getDeviceSyncStatusRow(
  tenantId: string,
  deviceId: string,
): Promise<{
  device_id: string
  pending_outbox_count: number
  last_pull_version: number | null
} | null> {
  return withE2eOwnerClient(async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      const res = await client.query<{
        device_id: string
        pending_outbox_count: number
        last_pull_version: number | null
      }>(
        'SELECT device_id, pending_outbox_count, last_pull_version FROM device_sync_status WHERE tenant_id = $1 AND device_id = $2',
        [tenantId, deviceId],
      )
      await client.query('COMMIT')
      return res.rows[0] ?? null
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

/**
 * Verifies K05 directly against Postgres under `solva_app_login`:
 * both UPDATE and DELETE on `audit_log` must fail with insufficient privilege / append-only trigger.
 */
export async function assertAuditLogImmutableAsAppLogin(
  tenantId: string,
  auditLogId: string,
): Promise<{ updateRejected: boolean; deleteRejected: boolean }> {
  return withE2eAppLoginClient(async (client) => {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
    let updateRejected = false
    let deleteRejected = false

    await client.query('SAVEPOINT sp_update')
    try {
      await client.query('UPDATE audit_log SET action = $1 WHERE id = $2', ['TAMPERED', auditLogId])
    } catch {
      updateRejected = true
      await client.query('ROLLBACK TO SAVEPOINT sp_update')
    }

    await client.query('SAVEPOINT sp_delete')
    try {
      await client.query('DELETE FROM audit_log WHERE id = $1', [auditLogId])
    } catch {
      deleteRejected = true
      await client.query('ROLLBACK TO SAVEPOINT sp_delete')
    }

    await client.query('ROLLBACK')
    return { updateRejected, deleteRejected }
  })
}

export async function clearActiveDevicesOnRegister(
  tenantId: string,
  registerId: string,
): Promise<void> {
  await withE2eOwnerClient(async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      await client.query(
        "UPDATE device SET revoked_at = now(), revoke_reason_code = 'REPLACED', updated_at = now() WHERE tenant_id = $1 AND register_id = $2 AND revoked_at IS NULL",
        [tenantId, registerId],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

export async function setTenantStatusDirect(
  tenantId: string,
  status: 'ACTIVE' | 'SUSPENDED',
): Promise<void> {
  await withE2eOwnerClient(async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      await client.query('UPDATE tenant SET status = $2, updated_at = now() WHERE id = $1', [
        tenantId,
        status,
      ])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

export async function createPairingCodeDirect(
  tenantId: string,
  registerId: string,
  issuedByAppUserId: string,
): Promise<string> {
  const { createPairingCode } = await import('../../../src/modules/identity/public')
  const { PERMISSION_CODES } = await import('../../../src/modules/identity/shared')
  const meta = await withE2eOwnerClient(async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      const res = await client.query<{ slug: string; auth_org_id: string }>(
        'SELECT slug, auth_org_id FROM tenant WHERE id = $1',
        [tenantId],
      )
      await client.query('COMMIT')
      return res.rows[0]!
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
  const result = await createPairingCode(
    {
      tenantId,
      tenantSlug: meta.slug,
      authOrgId: meta.auth_org_id,
      appUserId: issuedByAppUserId,
      permissions: new Set(PERMISSION_CODES),
      outletIds: null,
      roleCodes: ['OWNER'],
    },
    registerId,
  )
  return result.code
}

