export interface BoundedStoreOptions<V> {
  maxKeys: number
  ttlMs: number
  now: () => number
  isProtected?: (value: V, nowMs: number) => boolean
}

interface StoreEntry<V> {
  value: V
  expiresAtMs: number
}

/**
 * Size-bounded LRU + TTL in-memory store.
 * When full, expired entries are evicted first, then the oldest unprotected entry,
 * preserving active lockouts / blocks up to `maxKeys`.
 */
export class BoundedStore<V> {
  private readonly maxKeys: number
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly isProtected: (value: V, nowMs: number) => boolean
  private readonly map = new Map<string, StoreEntry<V>>()

  constructor(options: BoundedStoreOptions<V>) {
    if (!Number.isSafeInteger(options.maxKeys) || options.maxKeys < 1) {
      throw new Error(`BoundedStore maxKeys must be >= 1, received ${options.maxKeys}`)
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs < 1) {
      throw new Error(`BoundedStore ttlMs must be >= 1, received ${options.ttlMs}`)
    }
    this.maxKeys = options.maxKeys
    this.ttlMs = options.ttlMs
    this.now = options.now
    this.isProtected = options.isProtected ?? (() => false)
  }

  get(key: string): V | undefined {
    const nowMs = this.now()
    const entry = this.map.get(key)
    if (!entry) {
      return undefined
    }
    if (nowMs >= entry.expiresAtMs) {
      this.map.delete(key)
      return undefined
    }
    // Touch LRU order.
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: V, customTtlMs?: number): void {
    const nowMs = this.now()
    const ttl = customTtlMs !== undefined && customTtlMs > 0 ? customTtlMs : this.ttlMs
    const expiresAtMs = nowMs + ttl

    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxKeys) {
      this.evictOne(nowMs)
    }

    this.map.set(key, { value, expiresAtMs })
  }

  delete(key: string): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }

  private evictOne(nowMs: number): void {
    let evicted = false
    for (const [k, entry] of this.map) {
      if (nowMs >= entry.expiresAtMs) {
        this.map.delete(k)
        evicted = true
        if (this.map.size < this.maxKeys) {
          return
        }
      }
    }
    if (evicted && this.map.size < this.maxKeys) {
      return
    }

    for (const [k, entry] of this.map) {
      if (!this.isProtected(entry.value, nowMs)) {
        this.map.delete(k)
        return
      }
    }

    const oldestKey = this.map.keys().next().value
    if (oldestKey !== undefined) {
      this.map.delete(oldestKey)
    }
  }
}
