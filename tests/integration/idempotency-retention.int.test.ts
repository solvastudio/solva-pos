import { afterAll, describe, expect, it } from 'vitest'
import { blankOldIdempotencyResultsForTenant } from '~/modules/sync/public'
import { closePools } from '~/server/db'
import { newTestId, setupFnbTenant, withFnbAppTx } from './helpers/fnb'

describe('idempotency_command result retention', () => {
  afterAll(async () => {
    await closePools()
  })

  it('blanks old results inside the scan window and keeps the rows, recent results and older rows', async () => {
    const f = await setupFnbTenant('idem-ret')
    const insideWindowId = newTestId()
    const beforeWindowId = newTestId()
    const recentId = newTestId()
    const cutoff = '2025-02-01T00:00:00.000Z'

    await withFnbAppTx(f.tenantId, async (c) => {
      const insert = (id: string, receivedAt: string) =>
        c.query(
          `INSERT INTO idempotency_command
            (command_id, tenant_id, device_id, register_id, outlet_id, command_type, channel,
             schema_version, payload_hash, status, result, received_at)
           VALUES ($1, $2, $3, $4, $5, 'FinalizeSale', 'ONLINE', 1, repeat('a', 64), 'ACKED',
                   '{"sale_id":"x"}'::jsonb, $6)`,
          [id, f.tenantId, f.waiterDev.deviceId, f.waiterRegId, f.outletA, receivedAt],
        )
      await insert(insideWindowId, '2025-01-10T00:00:00.000Z')
      await insert(beforeWindowId, '2024-01-10T00:00:00.000Z')
      await insert(recentId, '2025-12-01T00:00:00.000Z')
    })

    expect(await blankOldIdempotencyResultsForTenant(f.tenantId, cutoff)).toBe(1)
    expect(await blankOldIdempotencyResultsForTenant(f.tenantId, cutoff)).toBe(0)

    const rows = await withFnbAppTx(f.tenantId, async (c) => {
      const res = await c.query<{ command_id: string; result: Record<string, unknown> }>(
        'SELECT command_id, result FROM idempotency_command WHERE command_id = ANY($1)',
        [[insideWindowId, beforeWindowId, recentId]],
      )
      return new Map(res.rows.map((r) => [r.command_id, r.result]))
    })
    expect(rows.size).toBe(3)
    expect(rows.get(insideWindowId)).toEqual({})
    expect(rows.get(beforeWindowId)).toEqual({ sale_id: 'x' })
    expect(rows.get(recentId)).toEqual({ sale_id: 'x' })
  })
})
