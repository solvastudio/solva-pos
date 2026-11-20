import type { StaffPinRecord } from '../db/types'

export class PinCryptoError extends Error {
  constructor(
    public readonly code: 'APP_ERROR',
    message: string,
  ) {
    super(message)
    this.name = 'PinCryptoError'
  }
}

export function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4)
  if (typeof globalThis.atob === 'function') {
    const bin = globalThis.atob(padded)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) {
      out[i] = bin.charCodeAt(i)
    }
    return out
  }
  return new Uint8Array(Buffer.from(padded, 'base64'))
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return globalThis.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Constant-time equality over two byte slices (ARCHITECTURE §6.4 step 4).
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i]! ^ b[i]!
  }
  return diff === 0
}

export async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const keyBuf = new Uint8Array(keyBytes).buffer
  const dataBuf = new Uint8Array(data).buffer
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, dataBuf)
  return new Uint8Array(sig)
}

async function derivePbkdf2Sha256(
  pin: string,
  salt: Uint8Array,
  iterations: number,
  hashLength: number,
): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(pin)
  const baseKey = await globalThis.crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveBits'])
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new Uint8Array(salt).buffer,
      iterations: Math.max(100_000, iterations),
    },
    baseKey,
    (hashLength || 32) * 8,
  )
  return new Uint8Array(bits)
}

/**
 * Computes `HMAC-SHA256(device_salt, slow_kdf(pin, kdf_salt, kdf_params))` directly in-thread.
 * Argon2id WASM is loaded lazily via dynamic `import('hash-wasm')`. Never silently falls back from
 * an `ARGON2ID` row to PBKDF2 — WASM failures throw `PinCryptoError('APP_ERROR')`.
 */
export async function computePinHashDirect(
  pin: string,
  staffPinRow: Pick<StaffPinRecord, 'device_salt' | 'kdf_algo' | 'kdf_params' | 'kdf_salt'>,
): Promise<Uint8Array> {
  const kdfSalt = base64UrlToBytes(staffPinRow.kdf_salt)
  const deviceSalt = base64UrlToBytes(staffPinRow.device_salt)

  let verifier: Uint8Array
  if (staffPinRow.kdf_algo === 'PBKDF2_SHA256') {
    verifier = await derivePbkdf2Sha256(
      pin,
      kdfSalt,
      staffPinRow.kdf_params.iterations,
      staffPinRow.kdf_params.hashLength,
    )
  } else {
    try {
      const { argon2id } = await import('hash-wasm')
      verifier = await argon2id({
        password: pin,
        salt: kdfSalt,
        parallelism: staffPinRow.kdf_params.parallelism,
        iterations: staffPinRow.kdf_params.iterations,
        memorySize: staffPinRow.kdf_params.memorySize,
        hashLength: staffPinRow.kdf_params.hashLength,
        outputType: 'binary',
      })
    } catch (err) {
      throw new PinCryptoError(
        'APP_ERROR',
        err instanceof Error ? err.message : 'Unable to initialize Argon2id WASM',
      )
    }
  }

  return hmacSha256(deviceSalt, verifier)
}

interface WorkerRequest {
  id: number
  pin: string
  staffPinRow: Pick<StaffPinRecord, 'device_salt' | 'kdf_algo' | 'kdf_params' | 'kdf_salt'>
}

interface WorkerResponse {
  id: number
  ok: boolean
  hash?: Uint8Array
  message?: string
}

let pinWorker: Worker | null = null
let nextWorkerReqId = 1

function runInWorker(
  worker: Worker,
  pin: string,
  staffPinRow: Pick<StaffPinRecord, 'device_salt' | 'kdf_algo' | 'kdf_params' | 'kdf_salt'>,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const id = nextWorkerReqId++
    const handleMessage = (ev: MessageEvent<WorkerResponse>) => {
      if (!ev.data || ev.data.id !== id) return
      cleanup()
      if (ev.data.ok && ev.data.hash) {
        resolve(ev.data.hash)
      } else {
        reject(new PinCryptoError('APP_ERROR', ev.data.message ?? 'PIN worker failed'))
      }
    }
    const handleError = (ev: ErrorEvent) => {
      cleanup()
      reject(new PinCryptoError('APP_ERROR', ev.message || 'PIN worker crashed'))
    }
    const cleanup = () => {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
    }
    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
    const req: WorkerRequest = {
      id,
      pin,
      staffPinRow: {
        device_salt: staffPinRow.device_salt,
        kdf_algo: staffPinRow.kdf_algo,
        kdf_params: staffPinRow.kdf_params,
        kdf_salt: staffPinRow.kdf_salt,
      },
    }
    worker.postMessage(req)
  })
}

/**
 * Verifies a staff PIN inside a Web Worker in browser environments (keeping UI responsive for 250–500ms)
 * and falls back cleanly in Node/test environments without Web Workers.
 */
export async function computePinHash(
  pin: string,
  staffPinRow: Pick<StaffPinRecord, 'device_salt' | 'kdf_algo' | 'kdf_params' | 'kdf_salt'>,
): Promise<Uint8Array> {
  if (typeof Worker !== 'undefined') {
    if (!pinWorker) {
      pinWorker = new Worker(new URL('./pin.worker.ts', import.meta.url), { type: 'module' })
    }
    return runInWorker(pinWorker, pin, staffPinRow)
  }
  return computePinHashDirect(pin, staffPinRow)
}
