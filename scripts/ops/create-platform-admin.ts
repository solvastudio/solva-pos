import { webcrypto } from 'node:crypto'
import { parseArgs } from 'node:util'
import { hashPassword } from 'better-auth/crypto'
import { Client } from 'pg'
import { createIdGenerator } from '~/lib/kernel'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

async function main(): Promise<number> {
  if (!process.env.APP_ENV) {
    process.stderr.write('APP_ENV environment variable must be set\n')
    return 1
  }

  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
    },
  })

  if (!values.email) {
    process.stderr.write(
      'Usage: PLATFORM_ADMIN_PASSWORD="<12+ chars>" npm run ops:create-platform-admin -- --email <email> [--name <name>]\n',
    )
    return 1
  }

  const normalizedEmail = values.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    process.stderr.write('Invalid email format\n')
    return 1
  }

  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? ''
  if (password.length < 12 || password.length > 128) {
    process.stderr.write(
      'PLATFORM_ADMIN_PASSWORD must be set and between 12 and 128 characters\n',
    )
    return 1
  }

  const displayName = (values.name ?? normalizedEmail.split('@')[0] ?? 'Operator').trim().slice(0, 80)
  const dbUrl = process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL
  if (!dbUrl) {
    process.stderr.write('DATABASE_OWNER_URL or DATABASE_URL must be set\n')
    return 1
  }

  const passwordHash = await hashPassword(password)
  const userId = idGen.newId()
  const accountId = idGen.newId()

  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    try {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM platform_user WHERE lower(email) = $1 LIMIT 1',
        [normalizedEmail],
      )
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK')
        process.stderr.write(`Platform admin already exists for email: ${normalizedEmail}\n`)
        return 1
      }

      await client.query(
        'INSERT INTO platform_user (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, now(), now())',
        [userId, displayName, normalizedEmail],
      )
      await client.query(
        'INSERT INTO platform_account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())',
        [accountId, userId, 'credential', userId, passwordHash],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  } finally {
    await client.end()
  }

  process.stdout.write(`Created platform admin: email=${normalizedEmail} id=${userId}\n`)
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Failed to create platform admin: ${msg}\n`)
    process.exitCode = 1
  })
