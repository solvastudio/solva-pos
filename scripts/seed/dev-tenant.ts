import { webcrypto } from 'node:crypto'
import { parseArgs } from 'node:util'
import { Client } from 'pg'
import { createIdGenerator, validateSlug } from '~/lib/kernel'

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
    process.stderr.write('seed:dev-tenant is forbidden when APP_ENV=production\n')
    return 1
  }

  const { values } = parseArgs({
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      status: { type: 'string', default: 'ACTIVE' },
    },
  })

  if (!values.slug || !values.name) {
    process.stderr.write(
      'Usage: npm run seed:dev-tenant -- --slug <slug> --name <name> [--status ACTIVE|SUSPENDED]\n',
    )
    return 1
  }

  const slugCheck = validateSlug(values.slug)
  if (!slugCheck.ok) {
    process.stderr.write(`Invalid slug (${slugCheck.reason}): "${values.slug}"\n`)
    return 1
  }

  if (values.name.length < 1 || values.name.length > 40) {
    process.stderr.write('Tenant name must be between 1 and 40 characters\n')
    return 1
  }

  const status = values.status ?? 'ACTIVE'
  if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
    process.stderr.write(`Invalid status: "${status}" (expected ACTIVE or SUSPENDED)\n`)
    return 1
  }

  const ownerUrl = process.env.DATABASE_OWNER_URL
  if (!ownerUrl) {
    process.stderr.write('DATABASE_OWNER_URL environment variable is not set\n')
    return 1
  }

  const id = idGen.newId()
  const client = new Client({ connectionString: ownerUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [id])
      await client.query(
        'INSERT INTO tenant (id, name, slug, status, version) VALUES ($1, $2, $3, $4, 1)',
        [id, values.name, slugCheck.slug, status],
      )
      await client.query('INSERT INTO tenant_sync (tenant_id, version) VALUES ($1, 1)', [id])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  } finally {
    await client.end()
  }

  process.stdout.write(`Seeded dev tenant: slug=${slugCheck.slug} status=${status} id=${id}\n`)
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Failed to seed dev tenant: ${msg}\n`)
    process.exitCode = 1
  })
