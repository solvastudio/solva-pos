import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { handleHealthRequest } from '~/routes/health'
import { closePools } from '~/server/db'
import { checkHealth } from '~/server/health'
import { captureLogs } from '~/server/logging/logger-core'

describe('/health check integration', () => {
  afterAll(async () => {
    await closePools()
  })

  it('returns 200 ok with X-App-Version header and zero access logs when DB and migrations are current', async () => {
    const logs = captureLogs('info')
    try {
      const res = await handleHealthRequest(new Request('https://app.solva.test/health'))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('X-App-Version')).toBeTruthy()

      const body = (await res.json()) as {
        status: string
        db: string
        migrations: string
        version: string
      }
      expect(body.status).toBe('ok')
      expect(body.db).toBe('up')
      expect(body.migrations).toBe('current')
      expect(logs.entries().filter((e) => e.scope === 'http')).toHaveLength(0)
    } finally {
      logs.stop()
    }
  })

  it('returns 503 degraded when expectedMigrations exceeds applied count, and 503 down when DB is unreachable', async () => {
    const current = await checkHealth()
    expect(current.httpStatus).toBe(200)

    const behind = await checkHealth({ expectedMigrations: 9999 })
    expect(behind).toEqual({
      httpStatus: 503,
      body: expect.objectContaining({
        status: 'degraded',
        db: 'up',
        migrations: 'behind',
      }),
    })

    const badPool = new Pool({
      connectionString: 'postgres://postgres:postgres@127.0.0.1:59999/solva_test',
      connectionTimeoutMillis: 300,
    })
    try {
      const down = await checkHealth({ pool: badPool, timeoutMs: 500 })
      expect(down).toEqual({
        httpStatus: 503,
        body: expect.objectContaining({
          status: 'down',
          db: 'down',
          migrations: 'unknown',
        }),
      })
    } finally {
      await badPool.end()
    }
  })
})
