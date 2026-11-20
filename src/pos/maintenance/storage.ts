import { getMeta, setMeta } from '../data/meta.repo'
import type { SolvaDb } from '../db/solva-db'

export type PersistStatus = 'GRANTED' | 'DENIED' | 'UNKNOWN'
export type StorageWarningLevel = 'ok' | 'warn' | 'prune'

export interface StorageManagerLike {
  persist?: () => Promise<boolean>
  persisted?: () => Promise<boolean>
  estimate?: () => Promise<{ usage?: number; quota?: number }>
}

function defaultStorageManager(): StorageManagerLike | null {
  if (typeof navigator !== 'undefined' && navigator.storage) {
    return navigator.storage as unknown as StorageManagerLike
  }
  return null
}

export function levelFor(usedPct: number): StorageWarningLevel {
  if (usedPct > 85) return 'prune'
  if (usedPct > 70) return 'warn'
  return 'ok'
}

export async function estimateUsage(
  storageManager?: StorageManagerLike | null,
): Promise<{ usage: number; quota: number; usedPct: number }> {
  const mgr = storageManager !== undefined ? storageManager : defaultStorageManager()
  if (!mgr || typeof mgr.estimate !== 'function') {
    return { usage: 0, quota: 0, usedPct: 0 }
  }
  try {
    const est = await mgr.estimate()
    const usage = typeof est.usage === 'number' && est.usage >= 0 ? est.usage : 0
    const quota = typeof est.quota === 'number' && est.quota > 0 ? est.quota : 0
    if (quota === 0) {
      return { usage, quota: 0, usedPct: 0 }
    }
    const usedPct = Math.min(100, Math.round((usage / quota) * 10000) / 100)
    return { usage, quota, usedPct }
  } catch {
    return { usage: 0, quota: 0, usedPct: 0 }
  }
}

/**
 * Requests persistent browser storage once (e.g., on first pairing) and records
 * the resulting `GRANTED`/`DENIED`/`UNKNOWN` state in `meta.storage`.
 */
export async function requestPersist(
  db: SolvaDb,
  storageManager?: StorageManagerLike | null,
): Promise<PersistStatus> {
  const mgr = storageManager !== undefined ? storageManager : defaultStorageManager()
  let persistStatus: PersistStatus = 'UNKNOWN'

  if (mgr && typeof mgr.persist === 'function') {
    try {
      const granted = await mgr.persist()
      persistStatus = granted ? 'GRANTED' : 'DENIED'
    } catch {
      persistStatus = 'DENIED'
    }
  }

  const prev = await getMeta(db, 'storage')
  await setMeta(db, 'storage', {
    persist: persistStatus,
    used_pct: prev?.used_pct ?? 0,
  })
  return persistStatus
}

export async function refreshStorageMeta(
  db: SolvaDb,
  storageManager?: StorageManagerLike | null,
): Promise<{ persist: PersistStatus; usedPct: number; level: StorageWarningLevel }> {
  const est = await estimateUsage(storageManager)
  const prev = await getMeta(db, 'storage')
  const persist: PersistStatus = prev?.persist ?? 'UNKNOWN'
  await setMeta(db, 'storage', {
    persist,
    used_pct: est.usedPct,
  })
  return {
    persist,
    usedPct: est.usedPct,
    level: levelFor(est.usedPct),
  }
}
