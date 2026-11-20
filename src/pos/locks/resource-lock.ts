import type { LockManagerLike } from './instance-lock'
import { printLockName, resourceLockName } from './names'

export type ResourceLockName =
  | `finalize:${string}`
  | `shift:${string}`
  | `bill:${string}`
  | `print:${string}`
  | 'pull-apply'
  | 'push-batch'
  | 'sync'

export interface WithResourceLockOptions<T> {
  tenantId: string
  deviceId: string
  name: ResourceLockName
  fn: () => Promise<T>
  locks?: LockManagerLike | null
  onFallback?: (lockKey: string) => void
}

const inProcessQueues = new Map<string, Promise<unknown>>()
let warnedFallback = false

function resolveWebLocks(override?: LockManagerLike | null): LockManagerLike | null {
  if (override !== undefined) return override
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks as unknown as LockManagerLike
  }
  return null
}

/**
 * Serializes critical device operations (`finalize:*`, `shift:*`, `pull-apply`,
 * `push-batch`, `sync`, `bill:*`, `print:*`) using an exclusive Web Lock or an
 * in-process promise mutex fallback when `navigator.locks` is unavailable.
 */
export async function withResourceLock<T>(options: WithResourceLockOptions<T>): Promise<T> {
  const fullName = options.name.startsWith('print:')
    ? printLockName(options.name.slice('print:'.length))
    : resourceLockName(options.tenantId, options.deviceId, options.name)

  const locks = resolveWebLocks(options.locks)
  if (locks) {
    return locks.request(fullName, { mode: 'exclusive' }, () => options.fn())
  }

  if (!warnedFallback) {
    warnedFallback = true
    options.onFallback?.(fullName)
  } else {
    // Allow explicit test callbacks if caller passed one without relying on module global.
    if (options.locks === null) {
      options.onFallback?.(fullName)
    }
  }

  const prev = inProcessQueues.get(fullName) ?? Promise.resolve()
  const nextRun = prev.then(
    () => options.fn(),
    () => options.fn(),
  )
  inProcessQueues.set(fullName, nextRun)
  try {
    return await nextRun
  } finally {
    if (inProcessQueues.get(fullName) === nextRun) {
      inProcessQueues.delete(fullName)
    }
  }
}

export function __resetResourceLockFallbackWarningForTests(): void {
  warnedFallback = false
  inProcessQueues.clear()
}
