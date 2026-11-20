import { businessDate, type OutletTimezone } from '~/lib/kernel'
import { setMeta } from '../data/meta.repo'
import type { SolvaDb } from '../db/solva-db'
import type { MetaValueMap } from '../db/types'

export const MAX_CLOCK_SAMPLE_RTT_MS = 5_000
export const MAX_CLOCK_SAMPLES = 5
export const CLOCK_BACK_THRESHOLD_MS = 5 * 60 * 1_000
export const CLOCK_OFFSET_WARN_MS = 10 * 60 * 1_000
export const CLOCK_ANOMALY_DRIFT_MS = 5_000

export interface ClockSampleInput {
  tSendDeviceMs: number
  rttMs: number
  serverTimeMs: number
}

interface StoredSample {
  offsetMs: number
  rttMs: number
  serverTimeMs: number
  measuredAtDeviceMs: number
}

export interface SyncClockDeps {
  db?: SolvaDb | null
  initialMeta?: MetaValueMap['clock'] | null
  nowMs?: () => number
  perfNow?: () => number
  onClockAnomaly?: (details: { deltaWallMs: number; deltaMonoMs: number }) => void
}

export interface SyncClock {
  recordSample(sample: ClockSampleInput): Promise<boolean>
  trustedNow(): number
  trustedNowIso(): string
  trustedBusinessDate(timezone?: OutletTimezone, dayCutoffTime?: string): string
  bumpMaxSeen(nowCorrectedMs: number): void
  isClockBack(): boolean
  offsetWarning(): boolean
  getOffsetMs(): number
  getMaxSeenMs(): number
  toMeta(): MetaValueMap['clock']
}

/**
 * Tracks Cristian RTT-weighted clock offset (`<= 5` recent samples, picking lowest RTT),
 * session monotonic drift guard, and persisted `max_seen_time` for clock-rollback checks.
 */
export function createSyncClock(deps: SyncClockDeps = {}): SyncClock {
  const nowMs = deps.nowMs ?? (() => Date.now())
  const perfNow =
    deps.perfNow ??
    (() => (typeof performance !== 'undefined' ? performance.now() : nowMs()))

  let offsetMs = deps.initialMeta?.offset_ms ?? 0
  let measuredAtDevice = deps.initialMeta?.measured_at_device ?? nowMs()
  let bestRttMs = deps.initialMeta?.rtt_ms ?? 0
  let serverTimeAtMeasure = deps.initialMeta?.server_time_at_measure ?? nowMs()
  let maxSeenMs = deps.initialMeta?.max_seen_time
    ? Date.parse(deps.initialMeta.max_seen_time) || 0
    : 0

  const anchor = {
    wall: nowMs(),
    mono: perfNow(),
  }
  let anomalyNotified = false
  const samples: StoredSample[] = []

  function currentWallNow(): number {
    const rawWall = nowMs()
    const monoNow = perfNow()
    const deltaWallMs = rawWall - anchor.wall
    const deltaMonoMs = monoNow - anchor.mono

    if (Math.abs(deltaWallMs - deltaMonoMs) > CLOCK_ANOMALY_DRIFT_MS) {
      if (!anomalyNotified) {
        anomalyNotified = true
        deps.onClockAnomaly?.({ deltaWallMs, deltaMonoMs })
      }
      return Math.round(anchor.wall + deltaMonoMs)
    }

    return rawWall
  }

  function trustedNow(): number {
    return currentWallNow() + offsetMs
  }

  function bumpMaxSeen(nowCorrectedMs: number): void {
    if (Number.isFinite(nowCorrectedMs) && nowCorrectedMs > maxSeenMs) {
      maxSeenMs = nowCorrectedMs
    }
  }

  function toMeta(): MetaValueMap['clock'] {
    return {
      offset_ms: Math.round(offsetMs),
      offset_at: new Date(measuredAtDevice).toISOString(),
      max_seen_time: new Date(maxSeenMs || trustedNow()).toISOString(),
      measured_at_device: measuredAtDevice,
      rtt_ms: bestRttMs,
      server_time_at_measure: serverTimeAtMeasure,
    }
  }

  async function recordSample(sample: ClockSampleInput): Promise<boolean> {
    if (
      !Number.isFinite(sample.rttMs) ||
      sample.rttMs < 0 ||
      sample.rttMs > MAX_CLOCK_SAMPLE_RTT_MS ||
      !Number.isFinite(sample.serverTimeMs)
    ) {
      return false
    }

    const computedOffset = Math.round(
      sample.serverTimeMs - (sample.tSendDeviceMs + sample.rttMs / 2),
    )

    samples.push({
      offsetMs: computedOffset,
      rttMs: sample.rttMs,
      serverTimeMs: sample.serverTimeMs,
      measuredAtDeviceMs: sample.tSendDeviceMs + sample.rttMs,
    })
    if (samples.length > MAX_CLOCK_SAMPLES) {
      samples.shift()
    }

    // Select lowest-RTT sample among the recent window to minimize asymmetric latency noise.
    let best = samples[0]!
    for (let i = 1; i < samples.length; i += 1) {
      if (samples[i]!.rttMs < best.rttMs) {
        best = samples[i]!
      }
    }

    offsetMs = best.offsetMs
    measuredAtDevice = Math.round(best.measuredAtDeviceMs)
    bestRttMs = Math.round(best.rttMs)
    serverTimeAtMeasure = Math.round(best.serverTimeMs)
    bumpMaxSeen(sample.serverTimeMs)

    if (deps.db && deps.db.isOpen()) {
      try {
        await setMeta(deps.db, 'clock', toMeta())
      } catch (err) {
        if (deps.db.isOpen()) throw err
      }
    }
    return true
  }

  return {
    recordSample,
    trustedNow,
    trustedNowIso: () => new Date(trustedNow()).toISOString(),
    trustedBusinessDate: (timezone: OutletTimezone = 'Asia/Jakarta', dayCutoffTime = '00:00') =>
      businessDate(new Date(trustedNow()).toISOString(), timezone, dayCutoffTime),
    bumpMaxSeen,
    isClockBack: () => trustedNow() < maxSeenMs - CLOCK_BACK_THRESHOLD_MS,
    offsetWarning: () => Math.abs(offsetMs) > CLOCK_OFFSET_WARN_MS,
    getOffsetMs: () => offsetMs,
    getMaxSeenMs: () => maxSeenMs,
    toMeta,
  }
}
