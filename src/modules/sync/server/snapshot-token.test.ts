import { describe, expect, it } from 'vitest'
import {
  SNAPSHOT_TOKEN_TTL_MS,
  signSnapshotToken,
  verifySnapshotToken,
} from './snapshot-token'

const SECRET = 'test-sync-token-secret-must-be-at-least-32-chars'
const DEVICE_A = '01950000-0000-7000-8000-00000000000a'
const DEVICE_B = '01950000-0000-7000-8000-00000000000b'

describe('snapshot-token HMAC signing and verification', () => {
  it('signs and verifies a valid token for the same device within 30 minutes', () => {
    const t0 = 1_700_000_000_000
    const token = signSnapshotToken(
      { deviceId: DEVICE_A, snapshotVersion: 42 },
      { secret: SECRET, nowMs: () => t0 },
    )

    const verified = verifySnapshotToken(token, DEVICE_A, {
      secret: SECRET,
      nowMs: () => t0 + 10 * 60 * 1000,
    })
    expect(verified).toEqual({
      deviceId: DEVICE_A,
      snapshotVersion: 42,
      iat: t0,
    })
  })

  it('rejects expired tokens (> 30 minutes)', () => {
    const t0 = 1_700_000_000_000
    const token = signSnapshotToken(
      { deviceId: DEVICE_A, snapshotVersion: 12 },
      { secret: SECRET, nowMs: () => t0 },
    )

    expect(() =>
      verifySnapshotToken(token, DEVICE_A, {
        secret: SECRET,
        nowMs: () => t0 + SNAPSHOT_TOKEN_TTL_MS + 1,
      }),
    ).toThrowError(/expired/i)
  })

  it('rejects tokens presented by a different device', () => {
    const t0 = 1_700_000_000_000
    const token = signSnapshotToken(
      { deviceId: DEVICE_A, snapshotVersion: 12 },
      { secret: SECRET, nowMs: () => t0 },
    )

    expect(() =>
      verifySnapshotToken(token, DEVICE_B, {
        secret: SECRET,
        nowMs: () => t0 + 1000,
      }),
    ).toThrowError(/another device/i)
  })

  it('rejects tampered payload or signature', () => {
    const t0 = 1_700_000_000_000
    const token = signSnapshotToken(
      { deviceId: DEVICE_A, snapshotVersion: 12 },
      { secret: SECRET, nowMs: () => t0 },
    )
    const [payloadB64, sigB64] = token.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({ deviceId: DEVICE_A, snapshotVersion: 9999, iat: t0 }),
      'utf8',
    ).toString('base64url')

    expect(() =>
      verifySnapshotToken(`${tamperedPayload}.${sigB64}`, DEVICE_A, {
        secret: SECRET,
        nowMs: () => t0 + 1000,
      }),
    ).toThrowError(/signature/i)

    const flippedSig = `${sigB64!.slice(0, -1)}${sigB64!.endsWith('a') ? 'b' : 'a'}`
    expect(() =>
      verifySnapshotToken(`${payloadB64}.${flippedSig}`, DEVICE_A, {
        secret: SECRET,
        nowMs: () => t0 + 1000,
      }),
    ).toThrowError(/signature/i)
  })
})
