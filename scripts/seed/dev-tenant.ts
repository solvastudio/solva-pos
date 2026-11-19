import { parseArgs } from 'node:util'
import { createTenant, setTenantStatus } from '~/modules/identity/public'
import { closePools } from '~/server/db'

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
      'owner-email': { type: 'string' },
      'owner-name': { type: 'string' },
    },
  })

  if (!values.slug || !values.name) {
    process.stderr.write(
      'Usage: npm run seed:dev-tenant -- --slug <slug> --name <name> [--status ACTIVE|SUSPENDED] [--owner-email <email>] [--owner-name <name>]\n',
    )
    return 1
  }

  const status = values.status ?? 'ACTIVE'
  if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
    process.stderr.write(`Invalid status: "${status}" (expected ACTIVE or SUSPENDED)\n`)
    return 1
  }

  const normalizedSlug = values.slug.trim().toLowerCase()
  const ownerEmail = values['owner-email'] ?? `dev-owner-${normalizedSlug}@example.test`
  const ownerDisplayName = values['owner-name'] ?? `${values.name.trim()} Owner`

  const op = { platformUserId: 'dev-seed-cli', email: 'dev-seed@localhost' }
  const created = await createTenant(op, {
    name: values.name,
    slug: values.slug,
    ownerEmail,
    ownerDisplayName,
  })

  if (status === 'SUSPENDED') {
    await setTenantStatus(op, created.tenantId, 'SUSPENDED')
  }

  process.stdout.write(
    `Seeded dev tenant: slug=${created.slug} status=${status} id=${created.tenantId} ownerInviteCode=${created.ownerInvite.code}\n`,
  )
  return 0
}

main()
  .then(async (code) => {
    await closePools()
    process.exitCode = code
  })
  .catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Failed to seed dev tenant: ${msg}\n`)
    await closePools().catch(() => undefined)
    process.exitCode = 1
  })
