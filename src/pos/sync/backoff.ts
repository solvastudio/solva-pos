export const BACKOFF_BASE_SECONDS = [5, 15, 60, 300] as const

/**
 * Computes jittered exponential backoff delay in milliseconds:
 * base [5, 15, 60, 300] seconds * Uniform(0.8, 1.2).
 */
export function nextDelayMs(
  failureIndex: number,
  rng: () => number = () => 0.5,
): number {
  const clamped = Math.max(0, Math.min(BACKOFF_BASE_SECONDS.length - 1, Math.floor(failureIndex)))
  const baseMs = BACKOFF_BASE_SECONDS[clamped]! * 1_000
  const jitter = 0.8 + Math.max(0, Math.min(1, rng())) * 0.4
  return Math.round(baseMs * jitter)
}
