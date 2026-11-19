import '@tanstack/react-start/server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSyncTokenSecret } from '~/server/env'
import { AppError } from '~/server/error-classify'

export const SNAPSHOT_TOKEN_TTL_MS = 30 * 60 * 1000

export interface SnapshotTokenPayload {
  deviceId: string
  snapshotVersion: number
  iat: number
}

export interface SnapshotTokenOptions {
  secret?: string
  nowMs?: () => number
}

function deriveSigningKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('solva:snapshot', 'utf8').digest()
}

function signDigest(key: Buffer, encodedPayload: string): string {
  return createHmac('sha256', key).update(encodedPayload, 'utf8').digest('base64url')
}

export function signSnapshotToken(
  input: { deviceId: string; snapshotVersion: number; iat?: number },
  opts?: SnapshotTokenOptions,
): string {
  const nowMs = (opts?.nowMs ?? (() => Date.now()))()
  const payload: SnapshotTokenPayload = {
    deviceId: input.deviceId,
    snapshotVersion: input.snapshotVersion,
    iat: input.iat ?? nowMs,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const key = deriveSigningKey(opts?.secret ?? getSyncTokenSecret())
  const signature = signDigest(key, encodedPayload)
  return `${encodedPayload}.${signature}`
}

export function verifySnapshotToken(
  token: string,
  expectedDeviceId: string,
  opts?: SnapshotTokenOptions,
): SnapshotTokenPayload {
  const dotIdx = token.indexOf('.')
  if (dotIdx <= 0 || dotIdx === token.length - 1 || token.indexOf('.', dotIdx + 1) !== -1) {
    throw new AppError('UNAUTHORIZED', 'Malformed snapshot token')
  }

  const encodedPayload = token.slice(0, dotIdx)
  const providedSig = token.slice(dotIdx + 1)
  const key = deriveSigningKey(opts?.secret ?? getSyncTokenSecret())
  const expectedSig = signDigest(key, encodedPayload)

  const providedBuf = Buffer.from(providedSig, 'utf8')
  const expectedBuf = Buffer.from(expectedSig, 'utf8')
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    throw new AppError('UNAUTHORIZED', 'Invalid snapshot token signature')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid snapshot token encoding')
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as SnapshotTokenPayload).deviceId !== 'string' ||
    !Number.isSafeInteger((parsed as SnapshotTokenPayload).snapshotVersion) ||
    (parsed as SnapshotTokenPayload).snapshotVersion < 0 ||
    !Number.isSafeInteger((parsed as SnapshotTokenPayload).iat)
  ) {
    throw new AppError('UNAUTHORIZED', 'Invalid snapshot token payload')
  }

  const payload = parsed as SnapshotTokenPayload
  if (payload.deviceId !== expectedDeviceId) {
    throw new AppError('FORBIDDEN', 'Snapshot token belongs to another device')
  }

  const nowMs = (opts?.nowMs ?? (() => Date.now()))()
  if (nowMs - payload.iat > SNAPSHOT_TOKEN_TTL_MS || payload.iat > nowMs + 60_000) {
    throw new AppError('UNAUTHORIZED', 'Snapshot token expired')
  }

  return payload
}
