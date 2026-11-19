import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { getClientIp } from '~/server/auth/rate-limit/client-ip'
import { getLimiters } from '~/server/auth/rate-limit/limiters'
import { withNoTenant } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { setContextField } from '~/server/logging/log-context'
import { callResolveDeviceByCredential } from './device.repo'

export interface DeviceContext {
  tenantId: string
  deviceId: string
  registerId: string
  outletId: string
  registerType: 'CASHIER' | 'WAITER'
}

export interface AuthenticateDeviceDeps {
  nowMs?: () => number
  remoteAddress?: string
}

const BEARER_TOKEN_PATTERN = /^Bearer\s+([A-Za-z0-9_-]{43})$/
const AUTH_CACHE_TTL_MS = 15_000
const AUTH_CACHE_MAX_ENTRIES = 2_000

interface CachedAuthEntry {
  ctx: DeviceContext
  expiresAtMs: number
}

// LRU map keyed by SHA-256 hex digest of the bearer token (never plaintext token).
const authCache = new Map<string, CachedAuthEntry>()

export function hashDeviceCredential(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export function invalidateDeviceAuthCacheByHash(credentialHash: Buffer): void {
  authCache.delete(credentialHash.toString('hex'))
}

export function invalidateDeviceAuthCacheByDeviceId(deviceId: string): void {
  for (const [key, entry] of authCache.entries()) {
    if (entry.ctx.deviceId === deviceId) {
      authCache.delete(key)
    }
  }
}

export function __clearDeviceAuthCacheForTests(): void {
  authCache.clear()
}

function getCachedContext(hexHash: string, nowMs: number): DeviceContext | null {
  const existing = authCache.get(hexHash)
  if (!existing) return null
  if (existing.expiresAtMs <= nowMs) {
    authCache.delete(hexHash)
    return null
  }
  // Refresh LRU order on read.
  authCache.delete(hexHash)
  authCache.set(hexHash, existing)
  return existing.ctx
}

function putCachedContext(hexHash: string, ctx: DeviceContext, expiresAtMs: number): void {
  if (authCache.has(hexHash)) {
    authCache.delete(hexHash)
  } else if (authCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = authCache.keys().next().value
    if (oldestKey !== undefined) {
      authCache.delete(oldestKey)
    }
  }
  authCache.set(hexHash, { ctx, expiresAtMs })
}

export class RateLimitRejectedError extends Error {
  readonly retryAfterMs: number
  readonly kind: 'interactive' | 'transient'

  constructor(retryAfterMs: number, kind: 'interactive' | 'transient') {
    super('Rate limit exceeded')
    this.name = 'RateLimitRejectedError'
    this.retryAfterMs = retryAfterMs
    this.kind = kind
  }
}

/**
 * Authenticates a POS device request via `Authorization: Bearer <256-bit base64url token>`.
 * Enforces revocation, expiration, active tenant/register status, and a 15-second LRU cache.
 */
export async function authenticateDevice(
  request: Request,
  deps?: AuthenticateDeviceDeps,
): Promise<DeviceContext> {
  const authHeader = request.headers.get('authorization')
  const match = authHeader ? BEARER_TOKEN_PATTERN.exec(authHeader.trim()) : null
  if (!match) {
    throw new AppError('UNAUTHORIZED', 'Missing or malformed bearer credential')
  }

  const token = match[1]!
  const nowMs = (deps?.nowMs ?? (() => Date.now()))()
  const credentialHash = hashDeviceCredential(token)
  const hexHash = credentialHash.toString('hex')

  const cached = getCachedContext(hexHash, nowMs)
  if (cached) {
    setContextField('tenantId', cached.tenantId)
    setContextField('deviceId', cached.deviceId)
    setContextField('registerId', cached.registerId)
    return cached
  }

  const ip = getClientIp(request, deps?.remoteAddress) ?? '0.0.0.0'
  const limiters = getLimiters()
  const badIpStatus = await limiters.badCredentialIp.peek(ip, nowMs)
  if (!badIpStatus.allowed) {
    throw new RateLimitRejectedError(badIpStatus.retryAfterMs, 'transient')
  }

  const row = await withNoTenant((tx) => callResolveDeviceByCredential(tx, credentialHash))
  if (!row) {
    const decision = await limiters.badCredentialIp.consume(ip, nowMs)
    if (!decision.allowed) {
      throw new RateLimitRejectedError(decision.retryAfterMs, 'transient')
    }
    throw new AppError('UNAUTHORIZED', 'Invalid device credential')
  }

  if (row.revokedAt !== null) {
    throw new AppError('DEVICE_REVOKED', 'Device credential has been revoked')
  }
  const expiresMs = Date.parse(row.credentialExpiresAt)
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    throw new AppError('CREDENTIAL_EXPIRED', 'Device credential has expired')
  }
  if (row.tenantStatus !== 'ACTIVE') {
    throw new AppError('TENANT_SUSPENDED', 'Tenant is not active')
  }
  if (row.registerStatus !== 'ACTIVE') {
    throw new AppError('FORBIDDEN', 'Register is inactive')
  }

  const ctx: DeviceContext = {
    tenantId: row.tenantId,
    deviceId: row.deviceId,
    registerId: row.registerId,
    outletId: row.outletId,
    registerType: row.registerType === 'WAITER' ? 'WAITER' : 'CASHIER',
  }

  putCachedContext(hexHash, ctx, Math.min(nowMs + AUTH_CACHE_TTL_MS, expiresMs))
  setContextField('tenantId', ctx.tenantId)
  setContextField('deviceId', ctx.deviceId)
  setContextField('registerId', ctx.registerId)

  return ctx
}
