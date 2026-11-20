import '@tanstack/react-start/server-only'
import {
  classOf,
  type DeviceLogEntry,
  type DeviceLogResponse,
} from '~/lib/contracts'
import { getLimiters } from '~/server/auth/rate-limit/limiters'
import { createLogger } from '~/server/log'
import type { SyncDeviceIdentity } from '../domain/command-types'

const deviceLog = createLogger('device')
const SENSITIVE_KEY_PATTERN =
  /(^|_)(pin|password|passwd|secret|token|credential|hash|salt|otp|code_hash|phone)(_|$)|customer|name/i

function sanitizeScalarCtx(ctx: Record<string, unknown> | undefined): string {
  if (!ctx) return ''
  const pairs: string[] = []
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) continue
    if (typeof v === 'string') {
      pairs.push(`${k}=${v.slice(0, 120)}`)
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      pairs.push(`${k}=${String(v)}`)
    }
  }
  return pairs.join(' ').slice(0, 300)
}

function stripUrlQueryParams(text: string | null | undefined, maxLen: number): string | undefined {
  if (!text) return undefined
  const cleaned = text.replace(/\?[^\s):]+/g, '')
  return cleaned.slice(0, maxLen)
}

/**
 * Ingests batch device diagnostic entries directly to structured server log files under
 * `scope: "device"`. Exceeding the per-device 10-minute rate limit silently drops excess
 * entries with `200 { received: 0, dropped }` so offline sync is never disrupted (BR-LOG-010).
 */
export async function ingestDeviceLog(
  device: SyncDeviceIdentity,
  entries: readonly DeviceLogEntry[],
  deps?: { nowMs?: () => number },
): Promise<DeviceLogResponse> {
  const nowMs = (deps?.nowMs ?? (() => Date.now()))()
  const rl = await getLimiters().deviceLog.consume(device.deviceId, nowMs)
  if (!rl.allowed) {
    return {
      received: 0,
      dropped: entries.length,
    }
  }

  for (const entry of entries) {
    const scalarSummary = sanitizeScalarCtx(entry.ctx)
    const stack = stripUrlQueryParams(entry.stack, 1000)
    const componentStack = stripUrlQueryParams(entry.component_stack, 1000)
    const route = stripUrlQueryParams(entry.route, 200)
    const message = scalarSummary ? `${entry.code}: ${scalarSummary}` : entry.code

    const logFields = {
      refLocal: entry.ref_local,
      tenantId: device.tenantId,
      deviceId: device.deviceId,
      registerId: device.registerId,
      errorClass: classOf(entry.code),
      publicCode: entry.code,
      appVersion: entry.app_version,
      schemaVersion: entry.schema_version,
      ...(route ? { route } : {}),
      ...(entry.clock_offset_ms !== null ? { label: `offset=${entry.clock_offset_ms}ms` } : {}),
      ...(componentStack ? { componentStack } : {}),
      clientError: {
        name: entry.code,
        message,
        ...(stack ? { stack } : {}),
      },
    }

    deviceLog[entry.level](logFields, 'device diagnostic')
  }

  return {
    received: entries.length,
  }
}
