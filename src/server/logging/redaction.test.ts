import { describe, expect, it } from 'vitest'
import { createLogger } from '../log'
import { captureLogs } from './logger-core'
import { handleRequestWithLog } from './request-log'

const SENTINELS = [
  'SENTINEL_PIN_9137',
  'SENTINEL_TOKEN',
  'SENTINEL_NAME',
  'SENTINEL_PHONE',
] as const

describe('server/logging redaction sentinel (NFR-OBS-002)', () => {
  it('never writes sentinel values to log lines or access paths', async () => {
    const cap = captureLogs('debug')
    const log = createLogger('redaction-test')

    try {
      // 1. Successful request carrying sentinels in query, header, and body
      const reqOk = new Request(
        'https://pos.local/acme/pos/checkout?pin=SENTINEL_PIN_9137&token=SENTINEL_TOKEN',
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer SENTINEL_TOKEN',
            'x-customer-name': 'SENTINEL_NAME',
            'x-customer-phone': 'SENTINEL_PHONE',
          },
          body: JSON.stringify({
            pin: 'SENTINEL_PIN_9137',
            customerName: 'SENTINEL_NAME',
            phone: 'SENTINEL_PHONE',
          }),
        },
      )

      const resOk = await handleRequestWithLog(reqOk, async () => {
        log.info({ saleId: '019a0000-0000-7000-8000-000000000001' }, 'checkout')
        return new Response('ok', { status: 200 })
      })
      expect(resOk.status).toBe(200)
      expect(resOk.headers.get('X-Request-Id')).toBeTruthy()

      // 2. Failing request with simulated pg error carrying sentinels in detail, where, parameters, and quoted message
      const reqErr = new Request(
        'https://pos.local/acme/api?token=SENTINEL_TOKEN',
        { method: 'POST', body: 'SENTINEL_PIN_9137' },
      )

      const resErr = await handleRequestWithLog(reqErr, async () => {
        const pgErr = Object.assign(
          new Error('insert failed for "SENTINEL_NAME"'),
          {
            code: '23505',
            severity: 'ERROR',
            detail: 'Key (pin)=(SENTINEL_PIN_9137)',
            where: 'SENTINEL_PHONE',
            parameters: ['SENTINEL_TOKEN', 'SENTINEL_PIN_9137'],
          },
        )
        throw pgErr
      })
      expect(resErr.status).toBe(500)
      const body = (await resErr.json()) as { error: { code: string; ref: string } }
      expect(body.error.code).toBe('INTERNAL_ERROR')
      expect(body.error.ref).toBe(resErr.headers.get('X-Request-Id'))

      // 3. /health is excluded from access logs
      await handleRequestWithLog(new Request('https://pos.local/health'), async () => {
        return new Response('ok', { status: 200 })
      })

      const rawOutput = cap.lines().join('\n')
      expect(rawOutput.length).toBeGreaterThan(0)
      for (const sentinel of SENTINELS) {
        expect(rawOutput).not.toContain(sentinel)
      }

      const entries = cap.entries()
      const paths = entries.map((e) => e.path).filter((p): p is string => typeof p === 'string')
      expect(paths).not.toContain('/health')
      for (const p of paths) {
        expect(p).not.toContain('?')
      }
    } finally {
      cap.stop()
    }
  })
})
