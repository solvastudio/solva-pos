import { APP_VERSION } from '~/lib/app-version'
import {
  HEADER_APP_VERSION,
  HEADER_SCHEMA_VERSION,
  HEADER_SYNC_PROTOCOL,
  SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  type ReleaseBlock,
} from '~/lib/contracts'
import { getMeta, setMeta } from '../data/meta.repo'
import type { SolvaDb } from '../db/solva-db'
import type { SyncClock } from './clock'

export type DeviceAuthFailureCode =
  | 'UNAUTHORIZED'
  | 'DEVICE_REVOKED'
  | 'CREDENTIAL_EXPIRED'
  | 'TENANT_SUSPENDED'
  | 'FORBIDDEN'

export type DeviceResult<T> =
  | { kind: 'ok'; data: T; serverTimeMs?: number; rttMs: number }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'server_error'; status: number }
  | { kind: 'auth'; code: DeviceAuthFailureCode }
  | { kind: 'update_required'; release?: ReleaseBlock | null }
  | { kind: 'invalid' }

export interface DeviceFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  timeoutMs?: number
  db: SolvaDb
  fetch?: typeof fetch
  nowMs?: () => number
  perfNow?: () => number
  clock?: SyncClock | null
  onTerminalAuthLock?: (code: 'DEVICE_REVOKED' | 'CREDENTIAL_EXPIRED' | 'TENANT_SUSPENDED') => void
}

const KNOWN_AUTH_CODES = new Set<DeviceAuthFailureCode>([
  'UNAUTHORIZED',
  'DEVICE_REVOKED',
  'CREDENTIAL_EXPIRED',
  'TENANT_SUSPENDED',
  'FORBIDDEN',
])

function parseRetryAfterMs(headerVal: string | null): number {
  if (!headerVal) return 30_000
  const asSeconds = Number(headerVal.trim())
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.max(1_000, Math.round(asSeconds * 1_000))
  }
  const asDate = Date.parse(headerVal)
  if (Number.isFinite(asDate)) {
    return Math.max(1_000, asDate - Date.now())
  }
  return 30_000
}

function parseServerTimeMs(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

async function persistSyncFlag(
  db: SolvaDb,
  patch: Partial<{
    revoked: boolean
    credential_expired: boolean
    tenant_suspended: boolean
    update_required: boolean
    server_max_schema: number
    server_behind: boolean
  }>,
): Promise<void> {
  const prev = (await getMeta(db, 'sync_flags')) ?? {}
  await setMeta(db, 'sync_flags', { ...prev, ...patch })
}

function mapReleaseBlock(release: ReleaseBlock) {
  return {
    app_version: release.min_supported_app_version ?? release.latest,
    schema_version: release.min_supported_schema_version,
    is_mandatory: release.is_mandatory,
    latest: release.latest,
    accept_previous_until: release.accept_previous_until,
    max_schema_version: release.max_schema_version,
  }
}

/**
 * Authenticated device HTTP client attaching Bearer credential & version headers,
 * updating clock samples, release metadata, and auth/schema sync flags automatically.
 */
export async function deviceFetch<T>(
  path: string,
  options: DeviceFetchOptions,
): Promise<DeviceResult<T>> {
  const fetchFn = options.fetch ?? globalThis.fetch
  const nowMs = options.nowMs ?? (() => Date.now())
  const perfNow =
    options.perfNow ??
    (() => (typeof performance !== 'undefined' ? performance.now() : nowMs()))

  const device = await getMeta(options.db, 'device')
  if (!device) {
    return { kind: 'auth', code: 'UNAUTHORIZED' }
  }

  const headers = new Headers({
    Authorization: `Bearer ${device.credential}`,
    [HEADER_APP_VERSION]: APP_VERSION,
    [HEADER_SCHEMA_VERSION]: String(SCHEMA_VERSION),
    [HEADER_SYNC_PROTOCOL]: String(SYNC_PROTOCOL_VERSION),
  })
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const tSendWall = nowMs()
  const pStart = perfNow()
  let res: Response

  try {
    res = await fetchFn(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal:
        options.timeoutMs &&
        typeof AbortSignal !== 'undefined' &&
        typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(options.timeoutMs)
          : undefined,
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { kind: 'timeout' }
    }
    return { kind: 'network' }
  }

  const rttMs = Math.max(0, perfNow() - pStart)

  if (res.status === 429) {
    return {
      kind: 'rate_limited',
      retryAfterMs: parseRetryAfterMs(res.headers.get('Retry-After')),
    }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (res.status === 426) {
    const release =
      body && typeof body === 'object' && 'release' in body
        ? ((body as { release?: ReleaseBlock | null }).release ?? null)
        : null
    if (release) {
      await setMeta(options.db, 'min_supported', mapReleaseBlock(release))
    }
    await persistSyncFlag(options.db, { update_required: true })
    return { kind: 'update_required', release }
  }

  if (res.status === 401 || res.status === 403) {
    const errCode =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      body.error &&
      typeof body.error === 'object' &&
      typeof (body.error as { code?: unknown }).code === 'string'
        ? ((body.error as { code: string }).code as DeviceAuthFailureCode)
        : null

    // Missing app error code (e.g. proxy/WAF HTML 401/403) is treated as transient per §C.
    if (!errCode || !KNOWN_AUTH_CODES.has(errCode)) {
      return { kind: 'server_error', status: res.status }
    }

    if (errCode === 'DEVICE_REVOKED') {
      await persistSyncFlag(options.db, { revoked: true })
      options.onTerminalAuthLock?.('DEVICE_REVOKED')
    } else if (errCode === 'CREDENTIAL_EXPIRED') {
      await persistSyncFlag(options.db, { credential_expired: true })
      options.onTerminalAuthLock?.('CREDENTIAL_EXPIRED')
    } else if (errCode === 'TENANT_SUSPENDED') {
      await persistSyncFlag(options.db, { tenant_suspended: true })
      options.onTerminalAuthLock?.('TENANT_SUSPENDED')
    }
    return { kind: 'auth', code: errCode }
  }

  if (res.status === 400 || res.status === 422) {
    return { kind: 'invalid' }
  }

  if (res.status >= 500 || !res.ok) {
    return { kind: 'server_error', status: res.status }
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const serverTimeMs = parseServerTimeMs(record.server_time)
  if (serverTimeMs !== undefined && options.clock) {
    await options.clock.recordSample({
      tSendDeviceMs: tSendWall,
      rttMs,
      serverTimeMs,
    })
  }

  if ('release' in record && record.release && typeof record.release === 'object') {
    const releaseObj = record.release as ReleaseBlock
    await setMeta(options.db, 'min_supported', mapReleaseBlock(releaseObj))
    const schemaStillSupported = SCHEMA_VERSION >= releaseObj.min_supported_schema_version
    await persistSyncFlag(options.db, {
      update_required: !schemaStillSupported,
      ...(typeof releaseObj.max_schema_version === 'number'
        ? {
            server_max_schema: releaseObj.max_schema_version,
            server_behind: releaseObj.max_schema_version < SCHEMA_VERSION,
          }
        : {}),
    })
  }

  if (typeof record.max_schema_version === 'number' && record.max_schema_version > 0) {
    await persistSyncFlag(options.db, {
      server_max_schema: record.max_schema_version,
      server_behind: record.max_schema_version < SCHEMA_VERSION,
    })
  }

  return {
    kind: 'ok',
    data: body as T,
    serverTimeMs,
    rttMs,
  }
}
