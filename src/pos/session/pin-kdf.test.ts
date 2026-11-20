import { describe, expect, it } from 'vitest'
import vector from '../../../tests/fixtures/pin-kdf-vector.json'
import { bytesToBase64Url, computePinHashDirect } from './pin-kdf'

describe('pos/session/pin-kdf (server <-> client consistency)', () => {
  it('produces byte-identical Argon2id + HMAC-SHA256 output to server kdf', async () => {
    const hash = await computePinHashDirect(vector.pin, {
      device_salt: vector.device_salt,
      kdf_algo: 'ARGON2ID',
      kdf_params: vector.kdf_params,
      kdf_salt: vector.kdf_salt,
    })

    expect(bytesToBase64Url(hash)).toBe(vector.pin_hash)
  })
})
