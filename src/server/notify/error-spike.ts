import '@tanstack/react-start/server-only'
import { getNotifier } from './notifier'

const SPIKE_WINDOW_MS = 5 * 60_000
const SPIKE_THRESHOLD = 10

export interface ErrorSpikeTracker {
  recordInternalError(nowMs?: number): { count: number; triggered: boolean }
  reset(): void
}

export function createErrorSpikeTracker(deps?: {
  windowMs?: number
  threshold?: number
  onSpike?: (count: number) => void
}): ErrorSpikeTracker {
  const windowMs = deps?.windowMs ?? SPIKE_WINDOW_MS
  const threshold = deps?.threshold ?? SPIKE_THRESHOLD
  const onSpike =
    deps?.onSpike ?? ((count: number) => getNotifier().notify('error_spike', { code: 'INTERNAL_ERROR', count }))

  let timestamps: number[] = []

  return {
    recordInternalError(nowMs: number = Date.now()) {
      timestamps = timestamps.filter((t) => nowMs - t <= windowMs)
      timestamps.push(nowMs)
      const count = timestamps.length
      if (count >= threshold) {
        onSpike(count)
        return { count, triggered: true }
      }
      return { count, triggered: false }
    },
    reset() {
      timestamps = []
    },
  }
}

const defaultTracker = createErrorSpikeTracker()

export function recordInternalError(nowMs?: number): { count: number; triggered: boolean } {
  return defaultTracker.recordInternalError(nowMs)
}

export function __resetErrorSpikeForTests(): void {
  defaultTracker.reset()
}
