import { webcrypto } from 'node:crypto'
import { parseArgs } from 'node:util'
import { hashPassword } from 'better-auth/crypto'
import { Client } from 'pg'
import { createIdGenerator, validateSlug } from '~/lib/kernel'
import { PERMISSION_CODES } from '~/modules/identity/shared'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

async function main(): Promise<number> {
  if (process.env.APP_ENV === 'production') {
    process.stderr.write('seed:dev-owner is forbidden when APP_ENV=production\n')
    return 1
  }

  const { values } = parseArgs({
    options: {
      slug: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
      name: { type: 'string' },
    },
  })

  if (!values.slug || !values.email || !values.password) {
    process.stderr.write(
      'Usage: npm run seed:dev-owner -- --slug <slug> --email <email> --password <password> [--name <name>]\n',
    )
    return 1
  }

  const slugCheck = validateSlug(values.slug)
  if (!slugCheck.ok) {
    process.stderr.write(`Invalid slug (${slugCheck.reason}): "${values.slug}"\n`)
    return 1
  }

  const normalizedEmail = values.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    process.stderr.write('Invalid email address format\n')
    return 1
  }

  if (values.password.length < 8) {
    process.stderr.write('Password must be at least 8 characters\n')
    return 1
  }

  const displayName = (values.name ?? normalizedEmail.split('@')[0] ?? 'Owner').trim().slice(0, 80)
  if (!displayName) {
    process.stderr.write('Display name must not be empty\n')
    return 1
  }

  const ownerUrl = process.env.DATABASE_OWNER_URL
  if (!ownerUrl) {
    process.stderr.write('DATABASE_OWNER_URL environment variable is not set\n')
    return 1
  }

  const passwordHash = await hashPassword(values.password)
  const client = new Client({ connectionString: ownerUrl })
  await client.connect()

  let tenantId: string
  let authUserId: string
  let appUserId: string

  try {
    await client.query('BEGIN')
    try {
      const tenantRes = await client.query<{
        id: string
        name: string
        slug: string
        auth_org_id: string | null
      }>('SELECT id, name, slug, auth_org_id FROM tenant WHERE slug = $1 LIMIT 1', [slugCheck.slug])

      if (tenantRes.rows.length === 0) {
        process.stderr.write(`Tenant not found for slug "${slugCheck.slug}". Run seed:dev-tenant first.\n`)
        await client.query('ROLLBACK')
        return 1
      }

      const tenantRow = tenantRes.rows[0]!
      tenantId = String(tenantRow.id).toLowerCase()
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])

      let authOrgId = tenantRow.auth_org_id
      if (!authOrgId) {
        const existingOrgRes = await client.query<{ id: string }>(
          'SELECT id FROM organization WHERE slug = $1 LIMIT 1',
          [tenantRow.slug],
        )
        if (existingOrgRes.rows.length > 0) {
          authOrgId = existingOrgRes.rows[0]!.id
        } else {
          authOrgId = idGen.newId()
          await client.query(
            'INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $3, now())',
            [authOrgId, tenantRow.name, tenantRow.slug],
          )
        }
        await client.query('UPDATE tenant SET auth_org_id = $1, updated_at = now() WHERE id = $2', [
          authOrgId,
          tenantId,
        ])
      }

      const userRes = await client.query<{ id: string }>(
        'SELECT id FROM "user" WHERE lower(email) = $1 LIMIT 1',
        [normalizedEmail],
      )
      if (userRes.rows.length > 0) {
        authUserId = userRes.rows[0]!.id
      } else {
        authUserId = idGen.newId()
        await client.query(
          'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, now(), now())',
          [authUserId, displayName, normalizedEmail],
        )
      }

      const accRes = await client.query<{ id: string }>(
        'SELECT id FROM account WHERE user_id = $1 AND provider_id = $2 LIMIT 1',
        [authUserId, 'credential'],
      )
      if (accRes.rows.length > 0) {
        await client.query(
          'UPDATE account SET password = $1, updated_at = now() WHERE id = $2',
          [passwordHash, accRes.rows[0]!.id],
        )
      } else {
        await client.query(
          'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())',
          [idGen.newId(), authUserId, 'credential', authUserId, passwordHash],
        )
      }

      const memberRes = await client.query<{ id: string }>(
        'SELECT id FROM member WHERE organization_id = $1 AND user_id = $2 LIMIT 1',
        [authOrgId, authUserId],
      )
      if (memberRes.rows.length === 0) {
        await client.query(
          'INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now())',
          [idGen.newId(), authOrgId, authUserId, 'owner'],
        )
      }

      const syncRes = await client.query<{ version: unknown }>(
        'UPDATE tenant_sync SET version = version + 1, updated_at = now() WHERE tenant_id = $1 RETURNING version',
        [tenantId],
      )
      const masterVersion = Number(syncRes.rows[0]!.version)

      const roleRes = await client.query<{ id: string }>(
        'SELECT id FROM role WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL LIMIT 1',
        [tenantId, 'OWNER'],
      )
      let ownerRoleId: string
      if (roleRes.rows.length > 0) {
        ownerRoleId = String(roleRes.rows[0]!.id).toLowerCase()
      } else {
        ownerRoleId = idGen.newId()
        await client.query(
          `INSERT INTO role (tenant_id, id, code, name, is_system, discount_limit_pct, version)
           VALUES ($1, $2, 'OWNER', 'Owner', true, 100, $3)`,
          [tenantId, ownerRoleId, masterVersion],
        )
      }

      for (const permCode of PERMISSION_CODES) {
        await client.query(
          `INSERT INTO role_permission (tenant_id, id, role_id, permission_code, version)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (role_id, permission_code) DO NOTHING`,
          [tenantId, idGen.newId(), ownerRoleId, permCode, masterVersion],
        )
      }

      const appUserRes = await client.query<{ id: string }>(
        'SELECT id FROM app_user WHERE tenant_id = $1 AND auth_user_id = $2 AND deleted_at IS NULL LIMIT 1',
        [tenantId, authUserId],
      )
      if (appUserRes.rows.length > 0) {
        appUserId = String(appUserRes.rows[0]!.id).toLowerCase()
        await client.query(
          `UPDATE app_user
           SET is_active = true, membership_status = 'ACTIVE', display_name = $1, version = $2, updated_at = now()
           WHERE tenant_id = $3 AND id = $4`,
          [displayName, masterVersion, tenantId, appUserId],
        )
      } else {
        appUserId = idGen.newId()
        await client.query(
          `INSERT INTO app_user (tenant_id, id, auth_user_id, display_name, is_active, membership_status, version)
           VALUES ($1, $2, $3, $4, true, 'ACTIVE', $5)`,
          [tenantId, appUserId, authUserId, displayName, masterVersion],
        )
      }

      const uoRes = await client.query<{ id: string }>(
        'SELECT id FROM user_outlet WHERE tenant_id = $1 AND user_id = $2 AND outlet_id IS NULL AND role_id = $3 AND deleted_at IS NULL LIMIT 1',
        [tenantId, appUserId, ownerRoleId],
      )
      if (uoRes.rows.length === 0) {
        await client.query(
          `INSERT INTO user_outlet (tenant_id, id, user_id, outlet_id, role_id, version)
           VALUES ($1, $2, $3, NULL, $4, $5)`,
          [tenantId, idGen.newId(), appUserId, ownerRoleId, masterVersion],
        )
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  } finally {
    await client.end()
  }

  process.stdout.write(
    `Seeded dev owner: slug=${slugCheck.slug} email=${normalizedEmail} authUserId=${authUserId} appUserId=${appUserId}\n`,
  )
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Failed to seed dev owner: ${msg}\n`)
    process.exitCode = 1
  })
