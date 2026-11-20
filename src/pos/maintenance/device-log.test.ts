import { afterEach, describe, expect, it } from 'vitest'
import { takePendingDeviceLogBatch, countDeviceLogs } from '../data/device-log.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { logDevice } from './device-log'

const T = '0192a000-0000-7000-8000-00000000a001'

afterEach(async () => {
  await deleteTenantDbForTests(T)
})

describe('pos/maintenance/device-log', () => {
  it('generates D-... ref_local, strips query/fragments & sensitive keys, and stores in device_log', async () => {
    const db = await openTenantDb(T)
    const refLocal = await logDevice(
      db,
      {
        level: 'error',
        code: 'APP_ERROR',
        route: '/acme/pos/pay?token=abc#pin=1234',
        stack: 'Error: crash\n  at Cart (assets/app.js?bust=1:12:4)',
        clockOffsetMs: 500,
        ctx: {
          area: 'cart',
          pin: '999999',
          token: 'secret-tok',
          customerName: 'Siti',
          attempt: 2,
        },
      },
      {
        correctedNowMs: () => Date.UTC(2026, 10, 20, 3, 15, 0),
        nowIso: () => '2026-11-20T03:15:00.000Z',
        rand: () => 0.1,
      },
    )

    expect(refLocal).toMatch(/^D-20261120-031500-[a-hj-km-np-z2-9]{5}$/)
    const rows = await takePendingDeviceLogBatch(db, 10)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.ref_local).toBe(refLocal)
    expect(rows[0]!.route).toBe('/acme/pos/pay')
    expect(rows[0]!.ctx).toEqual({ area: 'cart', attempt: 2 })
  })

  it('rejects unknown log codes outside DEVICE_LOG_CODES and enforces unique ref_local', async () => {
    const db = await openTenantDb(T)
    await expect(
      logDevice(db, { level: 'error', code: 'NOT_IN_CATALOG' }),
    ).rejects.toThrow(/Invalid device log code/i)
    expect(await countDeviceLogs(db)).toBe(0)

    const r1 = await logDevice(db, { level: 'info', code: 'SYNC_FAILED' }, { rand: () => 0.25 })
    const r2 = await logDevice(db, { level: 'info', code: 'SYNC_FAILED' }, { rand: () => 0.75 })
    expect(r1).not.toBe(r2)
  })
})
