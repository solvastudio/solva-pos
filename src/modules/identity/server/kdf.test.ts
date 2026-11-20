import { describe, expect, it } from 'vitest'
import vector from '../../../../tests/fixtures/pin-kdf-vector.json'
import { deriveVerifier, staffPinHash } from './kdf'

describe('identity/server/kdf', () => {
  it('reproduces fixed Argon2id verifier + HMAC-SHA256 staff_pin hash vector', async () => {
    const kdfSalt = Buffer.from(vector.kdf_salt, 'base64url')
    const deviceSalt = Buffer.from(vector.device_salt, 'base64url')

    const verifier = await deriveVerifier(vector.pin, kdfSalt, vector.kdf_params, 'ARGON2ID')
    expect(verifier.toString('base64url')).toBe(vector.verifier)

    const hash = staffPinHash(deviceSalt, verifier)
    expect(hash.toString('base64url')).toBe(vector.pin_hash)
  })

  it('produces different hashes per device salt for identical verifiers', async () => {
    const kdfSalt = Buffer.from(vector.kdf_salt, 'base64url')
    const verifier = await deriveVerifier(vector.pin, kdfSalt, vector.kdf_params, 'ARGON2ID')
    const h1 = staffPinHash(Buffer.alloc(16, 1), verifier)
    const h2 = staffPinHash(Buffer.alloc(16, 2), verifier)
    expect(h1.equals(h2)).toBe(false)
  })
})
