import type { BootResult } from '../boot/boot'

const bootPromiseBySlug = new Map<string, Promise<BootResult>>()

/**
 * Ensures `bootPos()` executes at most once per page load for a tenant slug,
 * sharing the cached result between route `beforeLoad` guards and screens.
 */
export function getCachedBootPos(slug: string): Promise<BootResult> {
  const key = slug.trim().toLowerCase()
  const existing = bootPromiseBySlug.get(key)
  if (existing) {
    return existing
  }
  const promise = import('../boot/boot').then(({ bootPos }) => bootPos(key))
  bootPromiseBySlug.set(key, promise)
  return promise
}

export function invalidateBootPosCache(slug?: string): void {
  if (slug) {
    bootPromiseBySlug.delete(slug.trim().toLowerCase())
    return
  }
  bootPromiseBySlug.clear()
}
