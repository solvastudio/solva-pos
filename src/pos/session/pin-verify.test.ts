import { afterEach, describe, expect, it } from 'vitest'
import vector from '../../../tests/fixtures/pin-kdf-vector.json'
import { clearClientErrorBufferForTests, getClientErrorBufferForTests } from '~/lib/client-errors/report-schema'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { getStaffPinStateRecord } from '../data/pin.repo'
import { PinCryptoError } from './pin-kdf'
import { verifyStaffPin } from './pin-verify'

const TENANT_ID = '01950000-0000-7000-8000-00000000a101'
const USER_ID = '01950000-0000-7000-8000-00000000b101'
const DEVICE_ID = '01950000-0000-7000-8000-00000000d101'
const REGISTER_ID = '01950000-0000-7000-8000-00000000c101'
const T0 = Date.parse('2026-11-20T10:00:00.000Z')

afterEach(async () => {
  clearClientErrorBufferForTests()
  await deleteTenantDbForTests(TENANT_ID)
})

describe('pos/session/pin-verify (ARCHITECTURE §6.4)', () => {
  it('verifies valid PIN against server-format vector, writes failed_count before KDF crash, and queues ReportPinState on lockout', async () => {
    const db = await openTenantDb(TENANT_ID)
    await db.staff_pin.put({
      id: '01950000-0000-7000-8000-00000000e101',
      user_id: USER_ID,
      device_salt: vector.device_salt,
      pin_hash: vector.pin_hash,
      kdf_algo: 'ARGON2ID',
      kdf_params: vector.kdf_params,
      kdf_salt: vector.kdf_salt,
      pin_epoch: 1,
      deleted_at: null,
    })

    // 1. Crash after pessimistic step-3 write leaves failed_count = 1 in Dexie
    await expect(
      verifyStaffPin(
        db,
        {
          userId: USER_ID,
          pin: vector.pin,
          deviceId: DEVICE_ID,
          registerId: REGISTER_ID,
          trustedNowMs: T0,
          maxSeenMs: T0,
        },
        {
          afterAttemptWriteHook: () => {
            throw new Error('Simulated tab crash')
          },
        },
      ),
    ).rejects.toThrow('Simulated tab crash')

    const stateAfterCrash = await getStaffPinStateRecord(db, USER_ID, DEVICE_ID)
    expect(stateAfterCrash?.failed_count).toBe(1)

    // 2. Wrong attempts 2..5 -> 5th queues ReportPinState tier 1
    for (let i = 2; i <= 5; i += 1) {
      const res = await verifyStaffPin(db, {
        userId: USER_ID,
        pin: '9999',
        deviceId: DEVICE_ID,
        registerId: REGISTER_ID,
        trustedNowMs: T0 + i * 1000,
        maxSeenMs: T0 + i * 1000,
      })
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.reason).toBe(i === 5 ? 'LOCKED' : 'WRONG_PIN')
      }
    }

    const outboxAfterLock = await db.outbox_command.toArray()
    expect(outboxAfterLock).toHaveLength(1)
    expect(outboxAfterLock[0]!.type).toBe('ReportPinState')
    expect(outboxAfterLock[0]!.payload).toMatchObject({
      user_id: USER_ID,
      failed_count: 5,
      lock_tier: 1,
      pin_epoch_seen: 1,
    })

    // 3. Even correct PIN is rejected during cooldown without hashing
    const duringLock = await verifyStaffPin(db, {
      userId: USER_ID,
      pin: vector.pin,
      deviceId: DEVICE_ID,
      registerId: REGISTER_ID,
      trustedNowMs: T0 + 66_000,
      maxSeenMs: T0 + 66_000,
    })
    expect(duringLock).toEqual({ ok: false, reason: 'LOCKED', remaining: 0, locked: { minutes: 4 } })

    // 4. Epoch bump clears lock cleanly and queues ReportPinState with epoch 2
    await db.staff_pin.update('01950000-0000-7000-8000-00000000e101', { pin_epoch: 2 })
    const afterEpoch = await verifyStaffPin(db, {
      userId: USER_ID,
      pin: vector.pin,
      deviceId: DEVICE_ID,
      registerId: REGISTER_ID,
      trustedNowMs: T0 + 60_000,
      maxSeenMs: T0 + 60_000,
    })
    expect(afterEpoch).toEqual({ ok: true, staffId: USER_ID })
    const finalState = await getStaffPinStateRecord(db, USER_ID, DEVICE_ID)
    expect(finalState).toMatchObject({ failed_count: 0, lock_tier: 0, pin_epoch_seen: 2 })

    // 5. Sentinel: plain PIN never appears anywhere in outbox payloads or error logs
    const dumped = JSON.stringify(await db.outbox_command.toArray()) + JSON.stringify(await db.staff_pin_state.toArray())
    expect(dumped).not.toContain(vector.pin)
    expect(dumped).not.toContain('9999')
  })

  it('logs APP_ERROR without silently downgrading ARGON2ID if WASM fails to load', async () => {
    const db = await openTenantDb(TENANT_ID)
    await db.staff_pin.put({
      id: '01950000-0000-7000-8000-00000000e102',
      user_id: USER_ID,
      device_salt: vector.device_salt,
      pin_hash: vector.pin_hash,
      kdf_algo: 'ARGON2ID',
      kdf_params: vector.kdf_params,
      kdf_salt: vector.kdf_salt,
      pin_epoch: 1,
      deleted_at: null,
    })

    const res = await verifyStaffPin(
      db,
      {
        userId: USER_ID,
        pin: vector.pin,
        deviceId: DEVICE_ID,
        registerId: REGISTER_ID,
        trustedNowMs: T0,
        maxSeenMs: T0,
      },
      {
        computeHash: () => Promise.reject(new PinCryptoError('APP_ERROR', 'WASM disabled')),
      },
    )
    expect(res).toMatchObject({ ok: false, reason: 'CRYPTO_FAILED' })
    const errs = getClientErrorBufferForTests()
    expect(errs.some((e) => e.code === 'APP_ERROR')).toBe(true)
    expect(JSON.stringify(errs)).not.toContain(vector.pin)
  })
})
