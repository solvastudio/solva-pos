import '@tanstack/react-start/server-only'
import { createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { argon2id } from 'hash-wasm'
import type { PinKdfParams } from './pin-schema'

/**
 * Default OWASP Argon2id parameters calibrated on real target hardware (`_dev/argon-bench`)
 * targeting 250–500 ms per attempt (NFR-PERF-007). Never auto-tuned without user calibration.
 */
export const DEFAULT_ARGON2ID_PARAMS: PinKdfParams = {
  memorySize: 19_456,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
}

export type PinKdfAlgo = 'ARGON2ID' | 'PBKDF2_SHA256'

export function generateSalt16(): Buffer {
  return randomBytes(16)
}

/**
 * Derives a slow per-user verifier from a plain 4–6 digit PIN using `hash-wasm` Argon2id
 * (or PBKDF2-SHA256 fallback if explicitly configured). Plain PIN is never stored or logged.
 */
export async function deriveVerifier(
  pin: string,
  salt: Uint8Array,
  params: PinKdfParams = DEFAULT_ARGON2ID_PARAMS,
  algo: PinKdfAlgo = 'ARGON2ID',
): Promise<Buffer> {
  if (algo === 'PBKDF2_SHA256') {
    return pbkdf2Sync(pin, salt, Math.max(100_000, params.iterations), params.hashLength || 32, 'sha256')
  }

  const out = await argon2id({
    password: pin,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySize,
    hashLength: params.hashLength,
    outputType: 'binary',
  })
  return Buffer.from(out)
}

/**
 * Derives device-bound `staff_pin.pin_hash = HMAC-SHA256(key = deviceSalt, data = verifier)`
 * so two enrolled devices never share the same stored hash for a staff member (FR-AUT-004).
 */
export function staffPinHash(deviceSalt: Uint8Array, verifier: Uint8Array): Buffer {
  return createHmac('sha256', deviceSalt).update(verifier).digest()
}
