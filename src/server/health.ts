import '@tanstack/react-start/server-only'
import type { Pool } from 'pg'
import { APP_VERSION } from '~/lib/app-version'
import { getBackgroundPool } from './db'
import { computeHealth, type HealthReport } from './health-core'

const DEFAULT_TIMEOUT_MS = 2_000

export interface CheckHealthOptions {
  expectedMigrations?: number
  timeoutMs?: number
  version?: string
  pool?: Pool
}

function defaultExpectedMigrations(): number {
  return typeof __MIGRATION_COUNT__ !== 'undefined' ? __MIGRATION_COUNT__ : 0
}

export async function checkHealth(
  opts?: CheckHealthOptions,
): Promise<{ httpStatus: 200 | 503; body: HealthReport }> {
  const pool = opts?.pool ?? getBackgroundPool()
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const expectedMigrations = opts?.expectedMigrations ?? defaultExpectedMigrations()
  const version = opts?.version ?? APP_VERSION

  let timer: NodeJS.Timeout | undefined
  try {
    const queryTask = (async () => {
      const client = await pool.connect()
      try {
        await client.query(`SET statement_timeout = ${Math.max(100, Math.floor(timeoutMs))}`)
        await client.query('SELECT 1')
        const migRes = await client.query<{ cnt: unknown }>(
          'SELECT count(*)::int AS cnt FROM drizzle.__drizzle_migrations',
        )
        const rawCnt = migRes.rows[0]?.cnt
        const applied = typeof rawCnt === 'number' ? rawCnt : Number(rawCnt)
        return Number.isSafeInteger(applied) ? applied : null
      } finally {
        // `SET` above is session-scoped; reset it so the pooled connection does not keep the short timeout.
        await client.query('RESET statement_timeout').catch(() => undefined)
        client.release()
      }
    })()

    const timeoutTask = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('health check timeout')), timeoutMs)
    })

    const appliedMigrations = await Promise.race([queryTask, timeoutTask])
    return computeHealth({
      dbOk: true,
      appliedMigrations,
      expectedMigrations,
      version,
    })
  } catch {
    return computeHealth({
      dbOk: false,
      appliedMigrations: null,
      expectedMigrations,
      version,
    })
  } finally {
    if (timer) clearTimeout(timer)
  }
}
