import { storageKey } from './names'

export type TenantStorageKind = 'local' | 'session'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface TenantStorage {
  get(key: string): string | null
  set(key: string, value: string): boolean
  remove(key: string): void
  rawKey(key: string): string
}

function resolveBrowserStorage(kind: TenantStorageKind): StorageLike | null {
  try {
    if (kind === 'local' && typeof localStorage !== 'undefined') {
      return localStorage
    }
    if (kind === 'session' && typeof sessionStorage !== 'undefined') {
      return sessionStorage
    }
  } catch {
    return null
  }
  return null
}

/**
 * Returns a tenant-prefixed `localStorage` or `sessionStorage` wrapper that
 * isolates keys per tenant under `solva:<tenantId>:*` and never throws on
 * restricted or full storage environments.
 */
export function getTenantStorage(
  tenantId: string,
  kind: TenantStorageKind,
  injectedStorage?: StorageLike | null,
): TenantStorage {
  const storage = injectedStorage !== undefined ? injectedStorage : resolveBrowserStorage(kind)

  return {
    rawKey(key: string): string {
      return storageKey(tenantId, key)
    },
    get(key: string): string | null {
      if (!storage) return null
      try {
        return storage.getItem(storageKey(tenantId, key))
      } catch {
        return null
      }
    },
    set(key: string, value: string): boolean {
      if (!storage) return false
      try {
        storage.setItem(storageKey(tenantId, key), value)
        return true
      } catch {
        return false
      }
    },
    remove(key: string): void {
      if (!storage) return
      try {
        storage.removeItem(storageKey(tenantId, key))
      } catch {
        // Ignore storage security/availability restrictions.
      }
    },
  }
}
