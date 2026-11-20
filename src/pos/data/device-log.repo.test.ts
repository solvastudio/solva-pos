import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { closeTenantDb, openTenantDb } from '../db/solva-db'
import { tenantDbName } from '../locks/names'
import {
  appendDeviceLogRow,
  countDeviceLogs,
  markDeviceLogSent,
  takePendingDeviceLogBatch,
} from './device-log.repo'

const T = '0192a000-0000-7000-8000-00000000a001'

afterEach(async () => {
  closeTenantDb(T)
  await Dexie.delete(tenantDbName(T))
})

const SAFE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function encodeSuffix(n: number): string {
  let v = n
  let out = ''
  for (let i = 0; i < 5; i += 1) {
    out = SAFE_ALPHABET[v % SAFE_ALPHABET.length]! + out
    v = Math.floor(v / SAFE_ALPHABET.length)
  }
  return out
}

function makeRow(idx: number) {
  const sec = String(idx % 60).padStart(2, '0')
  const suffix = encodeSuffix(idx)
  return {
    ref_local: `D-20261120-0100${sec}-${suffix}`,
    created_at: `2026-11-20T01:00:${sec}.000Z`,
    clock_offset_ms: 0,
    level: 'error' as const,
    code: 'APP_ERROR',
    route: '/acme/pos',
    stack: 'Error: boom',
    ctx: { attempt: idx },
    app_version: 'v1.0.0',
    schema_version: 1,
    send_status: 'PENDING' as const,
  }
}

describe('pos/data/device-log.repo', () => {
  it('enforces a strict 500-row cap by evicting oldest entries unconditionally', async () => {
    const db = await openTenantDb(T)

    for (let i = 1; i <= 505; i += 1) {
      await appendDeviceLogRow(db, makeRow(i))
    }

    expect(await countDeviceLogs(db)).toBe(500)
    const firstBatch = await takePendingDeviceLogBatch(db, 10)
    expect(firstBatch[0]?.ctx.attempt).toBe(6)

    const idsToDelete = firstBatch.map((r) => r.id!).slice(0, 5)
    await markDeviceLogSent(db, idsToDelete)
    expect(await countDeviceLogs(db)).toBe(495)
  })

  it('rejects duplicate ref_local and malformed codes', async () => {
    const db = await openTenantDb(T)
    const row = makeRow(9)
    await appendDeviceLogRow(db, row)

    await expect(appendDeviceLogRow(db, row)).rejects.toThrow()
    await expect(
      appendDeviceLogRow(db, { ...makeRow(10), code: 'lowercase-bad' }),
    ).rejects.toThrow()
  })
})
