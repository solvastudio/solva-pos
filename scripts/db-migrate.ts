import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

/**
 * Run all pending Drizzle SQL migrations using the owner connection string.
 */
export async function runMigrations(url: string): Promise<void> {
  if (!url) {
    throw new Error('DATABASE_OWNER_URL is required to run migrations')
  }

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const db = drizzle(client)
    await migrate(db, { migrationsFolder: 'drizzle' })
  } finally {
    await client.end()
  }
}

function listMigrationFiles(): string[] {
  return readdirSync(resolve('drizzle'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_OWNER_URL
  if (!url) {
    process.stderr.write('DATABASE_OWNER_URL environment variable is not set\n')
    return 1
  }

  const files = listMigrationFiles()
  await runMigrations(url)
  process.stdout.write(`Applied migrations (${files.length}): ${files.join(', ')}\n`)
  return 0
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isEntrypoint) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`Migration failed: ${msg}\n`)
      process.exitCode = 1
    })
}
