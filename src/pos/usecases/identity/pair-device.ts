import { resolveLocale } from '~/i18n/resolve-locale'
import { EnrollResponse } from '~/lib/contracts'
import { CODE_LENGTH_PAIRING, normalizeCode } from '~/lib/kernel'
import { writePairingMeta } from '../../data/meta.repo'
import { rememberTenant } from '../../db/registry'
import { openTenantDb, type SolvaDb } from '../../db/solva-db'
import { getTenantStorage } from '../../locks/tenant-storage'
import { requestPersist } from '../../maintenance/storage'
import { startInitialSync, type InitialSyncHandle } from '../../sync'

export type PairDeviceError =
  | 'INVALID'
  | 'RATE_LIMITED'
  | 'REGISTER_BUSY'
  | 'SUSPENDED'
  | 'NETWORK'
  | 'SERVER'

export type PairDeviceResult =
  | {
      ok: true
      tenantId: string
      db: SolvaDb
      syncHandle: InitialSyncHandle
    }
  | {
      ok: false
      error: PairDeviceError
      ref?: string
    }

export interface PairDeviceInput {
  slug: string
  code: string
  deviceName?: string
  userAgent?: string
}

export interface PairDeviceDeps {
  fetch?: typeof fetch
  nowMs?: () => number
  openDb?: (tenantId: string) => Promise<SolvaDb>
  remember?: typeof rememberTenant
  requestStoragePersist?: (db: SolvaDb) => Promise<unknown>
  startSync?: (db: SolvaDb, deps?: { fetch?: typeof fetch }) => InitialSyncHandle
  saveDeviceIdHint?: (tenantId: string, deviceId: string) => void
}

export function defaultDeviceName(): string {
  if (typeof navigator === 'undefined') {
    return 'POS Terminal'
  }
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  const raw = nav.userAgentData?.platform || nav.platform || 'POS Terminal'
  return raw.trim().slice(0, 80) || 'POS Terminal'
}

function extractApiErrorPayload(raw: unknown): { code?: string; ref?: string; reason?: string } {
  if (!raw || typeof raw !== 'object') return {}
  const rec = raw as Record<string, unknown>
  const errObj =
    rec.error && typeof rec.error === 'object' ? (rec.error as Record<string, unknown>) : rec
  return {
    code: typeof errObj.code === 'string' ? errObj.code : undefined,
    ref: typeof errObj.ref === 'string' ? errObj.ref : undefined,
    reason: typeof errObj.reason === 'string' ? errObj.reason : undefined,
  }
}

/**
 * Pairs this browser origin with a tenant register via `POST /api/pos/v1/enroll`.
 * Network use is restricted exclusively to pairing; credential tokens are persisted
 * inside IndexedDB `meta.device` only and never written to logs or browser web storage.
 */
export async function pairDevice(
  input: PairDeviceInput,
  deps: PairDeviceDeps = {},
): Promise<PairDeviceResult> {
  const fetchFn = deps.fetch ?? globalThis.fetch
  const nowMsFn = deps.nowMs ?? (() => Date.now())
  const openDb = deps.openDb ?? openTenantDb
  const remember = deps.remember ?? rememberTenant
  const startSync = deps.startSync ?? startInitialSync
  const saveDeviceIdHint =
    deps.saveDeviceIdHint ??
    ((tenantId: string, deviceId: string) => {
      getTenantStorage(tenantId, 'local').set('device_id', deviceId)
    })

  const normalized = normalizeCode(input.code) || input.code.toUpperCase().replace(/[\s-]+/g, '')
  if (normalized.length !== CODE_LENGTH_PAIRING) {
    return { ok: false, error: 'INVALID' }
  }

  const deviceName = (input.deviceName?.trim() || defaultDeviceName()).slice(0, 80)
  const userAgent =
    input.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : undefined)

  let response: Response
  try {
    response = await fetchFn('/api/pos/v1/enroll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        slug: input.slug.trim().toLowerCase(),
        code: normalized,
        device_name: deviceName,
        ...(userAgent ? { user_agent: userAgent } : {}),
      }),
    })
  } catch {
    return { ok: false, error: 'NETWORK' }
  }

  let rawBody: unknown
  try {
    rawBody = await response.json()
  } catch {
    rawBody = null
  }

  if (!response.ok) {
    const apiErr = extractApiErrorPayload(rawBody)
    if (response.status === 400) {
      return { ok: false, error: 'INVALID', ref: apiErr.ref }
    }
    if (response.status === 429 || apiErr.code === 'RATE_LIMITED') {
      return { ok: false, error: 'RATE_LIMITED', ref: apiErr.ref }
    }
    if (response.status === 409) {
      return { ok: false, error: 'REGISTER_BUSY', ref: apiErr.ref }
    }
    if (response.status === 403 && apiErr.code === 'TENANT_SUSPENDED') {
      return { ok: false, error: 'SUSPENDED', ref: apiErr.ref }
    }
    return { ok: false, error: 'SERVER', ref: apiErr.ref }
  }

  const enrolled = EnrollResponse.parse(rawBody)
  const nowMs = nowMsFn()
  const nowIso = new Date(nowMs).toISOString()

  const db = await openDb(enrolled.tenant.id)
  await remember({
    tenantId: enrolled.tenant.id,
    slug: enrolled.tenant.slug,
    nowIso,
  })

  await writePairingMeta(db, {
    device: {
      device_id: enrolled.device_id,
      credential: enrolled.credential,
      credential_expires_at: enrolled.credential_expires_at,
      tenant_id: enrolled.tenant.id,
      slug: enrolled.tenant.slug,
      register_id: enrolled.register.id,
      outlet_id: enrolled.outlet.id,
      register_type: enrolled.register.register_type,
    },
    tenant: {
      id: enrolled.tenant.id,
      name: enrolled.tenant.name,
      default_locale: enrolled.tenant.default_locale,
    },
    locale: resolveLocale({ tenant: enrolled.tenant.default_locale }),
    clock: {
      offset_ms: enrolled.server_time - nowMs,
      offset_at: nowIso,
      max_seen_time: new Date(enrolled.server_time).toISOString(),
    },
  })

  saveDeviceIdHint(enrolled.tenant.id, enrolled.device_id)

  const persistFn = deps.requestStoragePersist ?? ((d: SolvaDb) => requestPersist(d))
  await persistFn(db)

  const syncHandle = startSync(db, { fetch: fetchFn })
  return {
    ok: true,
    tenantId: enrolled.tenant.id,
    db,
    syncHandle,
  }
}
