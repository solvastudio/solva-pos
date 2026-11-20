import { APP_VERSION, compareSemver, parseSemver } from '~/lib/app-version'
import { newLocalRef } from '~/lib/client-errors/local-ref'
import { logClientError } from '~/lib/client-errors/report-schema'
import { SCHEMA_VERSION } from '~/lib/contracts/versions'
import { resolveLocale, type Locale } from '~/i18n/resolve-locale'
import { bulkGetMeta } from '../data/meta.repo'
import { findTenantIdBySlug } from '../db/registry'
import { openTenantDb, type SolvaDb } from '../db/solva-db'
import type { MetaValueMap } from '../db/types'
import { createInstanceLock, type InstanceLockHandle } from '../locks/instance-lock'
import { getTenantStorage, type TenantStorage } from '../locks/tenant-storage'
import { computeDeviceState, trustedNowMs, type DeviceState } from '../session/device-state'

export type BootResult =
  | { kind: 'NEEDS_PAIRING'; reason: 'UNKNOWN_SLUG' | 'UNPAIRED_DB' }
  | { kind: 'PASSIVE_DUPLICATE'; releaseLock: () => void; lockHandle?: InstanceLockHandle }
  | { kind: 'LOCAL_DB_FAILED'; ref: string }
  | {
      kind: 'READY'
      db: SolvaDb
      tenantId: string
      slug: string
      state: DeviceState
      locale: Locale
      device: MetaValueMap['device']
      tenant: MetaValueMap['tenant'] | null
      releaseLock: () => void
      lockHandle?: InstanceLockHandle
    }

export interface BootPosDeps {
  registry?: {
    findTenantIdBySlug(slug: string): Promise<string | null>
  }
  openDb?: (tenantId: string) => Promise<SolvaDb>
  createLock?: (tenantId: string, deviceId: string) => InstanceLockHandle
  tenantStorage?: (tenantId: string) => TenantStorage
  nowMs?: () => number
  perfNow?: () => number
}

const DEFAULT_LOCK_DEVICE_KEY = 'pos-tab'
let lastBootDurationMs: number | null = null

export function getLastBootDurationMs(): number | null {
  return lastBootDurationMs
}

function isClientVersionBelowMin(minSupported: MetaValueMap['min_supported']): boolean {
  if (!minSupported) return false
  if (SCHEMA_VERSION < minSupported.schema_version) {
    return true
  }
  if (parseSemver(APP_VERSION) && parseSemver(minSupported.app_version)) {
    return compareSemver(APP_VERSION, minSupported.app_version) < 0
  }
  return false
}

/**
 * Executes the strict offline-first POS boot sequence (ARCHITECTURE §3.1):
 * 1. Resolves tenant UUID from local `solva-registry` (never opens DB for unknown slug).
 * 2. Acquires exclusive Web Lock per `(tenantId, deviceId)`; passive tabs never open Dexie.
 * 3. Opens `solva-pos:<tenantId>`. On open failure logs `LOCAL_DB_FAILED` without deleting DB.
 * 4. Reads local metadata via single `bulkGetMeta`.
 * 5. Computes `DeviceState` and resolves UI locale completely offline (zero network calls).
 */
export async function bootPos(slug: string, deps: BootPosDeps = {}): Promise<BootResult> {
  const perfNow =
    deps.perfNow ??
    (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const nowMsFn = deps.nowMs ?? (() => Date.now())
  const t0 = perfNow()

  const findSlug = deps.registry?.findTenantIdBySlug ?? findTenantIdBySlug
  const openDb = deps.openDb ?? openTenantDb
  const getStorage =
    deps.tenantStorage ?? ((tid: string) => getTenantStorage(tid, 'local'))
  const createLock =
    deps.createLock ??
    ((tenantId: string, deviceId: string) => createInstanceLock({ tenantId, deviceId }))

  const tenantId = await findSlug(slug)
  if (!tenantId) {
    lastBootDurationMs = perfNow() - t0
    return { kind: 'NEEDS_PAIRING', reason: 'UNKNOWN_SLUG' }
  }

  const storage = getStorage(tenantId)
  const storedDeviceId = storage.get('device_id') ?? DEFAULT_LOCK_DEVICE_KEY
  const lockHandle = createLock(tenantId, storedDeviceId)
  const lockRole = await lockHandle.acquire()

  if (lockRole === 'passive') {
    lastBootDurationMs = perfNow() - t0
    return {
      kind: 'PASSIVE_DUPLICATE',
      releaseLock: () => lockHandle.release(),
      lockHandle,
    }
  }

  let db: SolvaDb
  try {
    db = await openDb(tenantId)
  } catch (err) {
    lockHandle.release()
    const ref = newLocalRef(nowMsFn())
    logClientError({
      refLocal: ref,
      code: 'LOCAL_DB_FAILED',
      level: 'error',
      route: `/${slug}/pos`,
      stack: err instanceof Error ? err.stack ?? err.message : String(err),
      ctx: { tenantId, stage: 'openTenantDb' },
    })
    lastBootDurationMs = perfNow() - t0
    return { kind: 'LOCAL_DB_FAILED', ref }
  }

  const meta = await bulkGetMeta(db, [
    'device',
    'cursor',
    'clock',
    'last_success_sync_at',
    'locale',
    'idle_lock',
    'min_supported',
    'tenant',
    'storage',
    'device_flags',
    'sync_flags',
  ])

  if (!meta.device) {
    lockHandle.release()
    lastBootDurationMs = perfNow() - t0
    return { kind: 'NEEDS_PAIRING', reason: 'UNPAIRED_DB' }
  }

  storage.set('device_id', meta.device.device_id)

  const clockOffsetMs = meta.clock?.offset_ms ?? 0
  const maxSeenTimeMs = meta.clock?.max_seen_time ? Date.parse(meta.clock.max_seen_time) : 0
  const trustedNow = trustedNowMs({
    nowMs: nowMsFn(),
    clockOffsetMs,
    maxSeenMs: Number.isFinite(maxSeenTimeMs) ? maxSeenTimeMs : 0,
  })
  const lastSyncMs = meta.last_success_sync_at ? Date.parse(meta.last_success_sync_at) : null

  const state = computeDeviceState({
    hasDevice: true,
    trustedNowMs: trustedNow,
    lastSuccessSyncAtMs: lastSyncMs !== null && Number.isFinite(lastSyncMs) ? lastSyncMs : null,
    maxSeenTimeMs: Number.isFinite(maxSeenTimeMs) ? maxSeenTimeMs : 0,
    flags: {
      revoked: meta.sync_flags?.revoked ?? meta.device_flags?.revoked,
      credentialExpired: meta.sync_flags?.credential_expired ?? meta.device_flags?.credential_expired,
      tenantSuspended: meta.sync_flags?.tenant_suspended ?? meta.device_flags?.tenant_suspended,
      updateRequired:
        meta.sync_flags?.update_required || isClientVersionBelowMin(meta.min_supported ?? null),
    },
  })

  const locale = resolveLocale({
    register: meta.locale ?? null,
    tenant: meta.tenant?.default_locale ?? null,
  })

  lastBootDurationMs = perfNow() - t0
  return {
    kind: 'READY',
    db,
    tenantId,
    slug,
    state,
    locale,
    device: meta.device,
    tenant: meta.tenant ?? null,
    releaseLock: () => lockHandle.release(),
    lockHandle,
  }
}
