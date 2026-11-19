import '@tanstack/react-start/server-only'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg, { Pool } from 'pg'
import { requireDbEnv } from '../env'
import { parseSafeBigint } from './columns'

// Ensure int8 (OID 20) parses to safe JS integer or throws instead of returning string or losing precision.
pg.types.setTypeParser(20, parseSafeBigint)
// Keep timestamptz (OID 1184) as raw UTC string from PostgreSQL for consistent ISO truncation.
pg.types.setTypeParser(1184, (val) => val)

let mainPool: Pool | null = null
let bgPool: Pool | null = null

export function getPool(): Pool {
  if (!mainPool) {
    const { DATABASE_URL } = requireDbEnv()
    mainPool = new Pool({
      connectionString: DATABASE_URL,
      max: 15,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  }
  return mainPool
}

export function getBackgroundPool(): Pool {
  if (!bgPool) {
    const { DATABASE_URL } = requireDbEnv()
    bgPool = new Pool({
      connectionString: DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  }
  return bgPool
}

export function getDb(): NodePgDatabase {
  return drizzle(getPool())
}

export async function closePools(): Promise<void> {
  const closing: Promise<void>[] = []
  if (mainPool) {
    const p = mainPool
    mainPool = null
    closing.push(p.end())
  }
  if (bgPool) {
    const p = bgPool
    bgPool = null
    closing.push(p.end())
  }
  await Promise.all(closing)
}
