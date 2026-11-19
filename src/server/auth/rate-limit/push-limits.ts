import '@tanstack/react-start/server-only'
import { RateLimitRejectedError } from '~/modules/identity/public'
import { getLimiters } from './limiters'

const perDeviceInFlight = new Map<string, number>()
const MAX_CONCURRENT_PER_DEVICE = 1

function jitteredPushRetryMs(random: () => number): number {
  // Base 3..8s produces 2..10s after rateLimitedResponse's +-20% transient jitter.
  return 3_000 + Math.floor(random() * 5_000)
}

/**
 * Acquires both the per-device in-flight push slot (max 1) and the global push concurrency
 * semaphore (`RL_PUSH_CONCURRENCY`). Throws `RateLimitRejectedError` when saturated.
 */
export function tryAcquirePushSlot(
  deviceId: string,
  random: () => number = Math.random,
): () => void {
  const activeForDevice = perDeviceInFlight.get(deviceId) ?? 0
  if (activeForDevice >= MAX_CONCURRENT_PER_DEVICE) {
    throw new RateLimitRejectedError(jitteredPushRetryMs(random), 'transient')
  }

  const globalRelease = getLimiters().pushSemaphore.tryAcquire('push')
  if (!globalRelease) {
    throw new RateLimitRejectedError(jitteredPushRetryMs(random), 'transient')
  }

  perDeviceInFlight.set(deviceId, activeForDevice + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (perDeviceInFlight.get(deviceId) ?? 1) - 1
    if (remaining <= 0) {
      perDeviceInFlight.delete(deviceId)
    } else {
      perDeviceInFlight.set(deviceId, remaining)
    }
    globalRelease()
  }
}

export function __resetPushLimitsForTests(): void {
  perDeviceInFlight.clear()
}
