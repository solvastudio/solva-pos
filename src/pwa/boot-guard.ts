export type BootAction = 'RETRY' | 'USE_LAST_GOOD' | 'RECOVERY'

export interface BootLastGoodMeta {
  appVersion?: string
  dexieVersion: number
}

export const DEFAULT_BOOT_FAIL_WINDOW_MS = 60_000

export function bootFailStorageKey(tenantKey: string): string {
  return `solva:${tenantKey}:bootfail`
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

export interface BootFailureStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function recordBootCrashTimestamp(
  tenantKey: string,
  nowMs: number,
  storage: BootFailureStorage | null,
  windowMs: number = DEFAULT_BOOT_FAIL_WINDOW_MS,
): { count: number; shouldRecover: boolean } {
  if (!storage) {
    return { count: 1, shouldRecover: false }
  }

  const key = bootFailStorageKey(tenantKey)
  const cutoff = nowMs - windowMs
  let timestamps: number[] = []

  try {
    const raw = storage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        timestamps = parsed.filter(
          (ts): ts is number =>
            typeof ts === 'number' && Number.isFinite(ts) && ts >= cutoff && ts <= nowMs,
        )
      }
    }
    timestamps.push(nowMs)
    storage.setItem(key, JSON.stringify(timestamps))
  } catch {
    return { count: 1, shouldRecover: false }
  }

  return {
    count: timestamps.length,
    shouldRecover: timestamps.length >= 2,
  }
}

export function clearBootCrashHistory(
  tenantKey: string,
  storage: Pick<BootFailureStorage, 'removeItem'> | null,
): void {
  if (!storage) return
  try {
    storage.removeItem(bootFailStorageKey(tenantKey))
  } catch {
    // Ignore restricted storage environments.
  }
}
