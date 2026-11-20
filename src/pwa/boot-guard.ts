import { getTenantStorage, type StorageLike } from '~/pos/locks/tenant-storage'

export type BootAction = 'RETRY' | 'USE_LAST_GOOD' | 'RECOVERY'

export interface BootLastGoodMeta {
  appVersion?: string
  dexieVersion: number
}

export const DEFAULT_BOOT_FAIL_WINDOW_MS = 60_000
const BOOT_FAIL_SUFFIX = 'bootfail'

export function bootFailStorageKey(tenantKey: string): string {
  return `solva:${tenantKey}:${BOOT_FAIL_SUFFIX}`
}

/**
 * Pure boot-failure escalation policy:
 * - count <= 1 => RETRY
 * - count === 2 => USE_LAST_GOOD only when a compatible lastGood exists (dexieVersion >= clientDbVersion), else RECOVERY
 * - count >= 3 => RECOVERY
 */
export function onBootFailure(
  count: number,
  lastGood?: BootLastGoodMeta | null,
  clientDbVersion: number = 0,
): BootAction {
  if (!Number.isFinite(count) || count <= 1) {
    return 'RETRY'
  }
  if (count === 2) {
    if (lastGood === null) {
      return 'RECOVERY'
    }
    if (lastGood !== undefined && lastGood.dexieVersion < clientDbVersion) {
      return 'RECOVERY'
    }
    return 'USE_LAST_GOOD'
  }
  return 'RECOVERY'
}

export type BootFailureStorage = StorageLike

export function recordBootCrashTimestamp(
  tenantKey: string,
  nowMs: number,
  storage?: BootFailureStorage | null,
  windowMs: number = DEFAULT_BOOT_FAIL_WINDOW_MS,
): { count: number; shouldRecover: boolean } {
  const tenantStorage = getTenantStorage(tenantKey, 'session', storage)
  const cutoff = nowMs - windowMs
  let timestamps: number[] = []

  const raw = tenantStorage.get(BOOT_FAIL_SUFFIX)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        timestamps = parsed.filter(
          (ts): ts is number =>
            typeof ts === 'number' && Number.isFinite(ts) && ts >= cutoff && ts <= nowMs,
        )
      }
    } catch {
      timestamps = []
    }
  }
  timestamps.push(nowMs)
  const persisted = tenantStorage.set(BOOT_FAIL_SUFFIX, JSON.stringify(timestamps))
  if (!persisted) {
    return { count: 1, shouldRecover: false }
  }

  return {
    count: timestamps.length,
    shouldRecover: timestamps.length >= 2,
  }
}

export function clearBootCrashHistory(
  tenantKey: string,
  storage?: Pick<BootFailureStorage, 'removeItem'> | null,
): void {
  const wrappedStorage =
    storage !== undefined
      ? storage
        ? ({
            getItem: () => null,
            setItem: () => {},
            removeItem: (k: string) => storage.removeItem(k),
          } satisfies StorageLike)
        : null
      : undefined
  getTenantStorage(tenantKey, 'session', wrappedStorage).remove(BOOT_FAIL_SUFFIX)
}
