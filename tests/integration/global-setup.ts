import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { runMigrations } from '../../scripts/db-migrate'

/**
 * Recreate the isolated `solva_test` database and apply all migrations before the `db` test suite runs.
 */
export default async function setup(): Promise<void> {
  const adminUrl =
    process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
  const rolesSql = readFileSync(resolve('docker/init-roles.sql'), 'utf8')

  const parsed = new URL(adminUrl)
  const host = parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname || 'localhost'
  const port = parsed.port || '5432'

  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(rolesSql)
    await admin.query('DROP DATABASE IF EXISTS solva_test WITH (FORCE)')
    await admin.query('CREATE DATABASE solva_test OWNER solva_owner')
  } finally {
    await admin.end()
  }

  const ownerUrl = `postgres://solva_owner:solva_owner_dev@${host}:${port}/solva_test`
  const appUrl = `postgres://solva_app_login:solva_app_dev@${host}:${port}/solva_test`
  const adminDbUrl = new URL(adminUrl)
  adminDbUrl.pathname = '/solva_test'

  process.env.TEST_OWNER_URL = ownerUrl
  process.env.TEST_APP_URL = appUrl
  process.env.TEST_ADMIN_DB_URL = adminDbUrl.toString()

  await runMigrations(ownerUrl)
}
