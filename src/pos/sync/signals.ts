import { APP_VERSION } from '~/lib/app-version'
import {
  HEADER_APP_VERSION,
  HEADER_SCHEMA_VERSION,
  HEADER_SYNC_PROTOCOL,
  SCHEMA_VERSION,
  SignalMessageSchema,
  SYNC_PROTOCOL_VERSION,
  type SignalMessage,
} from '~/lib/contracts'
import { getMeta } from '../data/meta.repo'
import type { SolvaDb } from '../db/solva-db'

export const SIGNAL_SILENCE_TIMEOUT_MS = 90_000
export const SIGNAL_MIN_RECONNECT_MS = 1_000
export const SIGNAL_MAX_RECONNECT_MS = 30_000

export interface SseClientOptions {
  db: SolvaDb
  onSignal: (msg: SignalMessage) => void
  fetch?: typeof fetch
  rng?: () => number
  silenceTimeoutMs?: number
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (id: unknown) => void
  onAuthTerminal?: () => void
}

export interface SseClientController {
  start(): void
  stop(): void
}

export function parseSseChunk(
  buffer: string,
  emitSignal: (msg: SignalMessage) => void,
): string {
  const parts = buffer.split(/\r?\n\r?\n/)
  const remainder = parts.pop() ?? ''

  for (const frame of parts) {
    const lines = frame.split(/\r?\n/)
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const jsonStr = line.slice('data:'.length).trim()
      if (!jsonStr) continue
      try {
        const parsed = SignalMessageSchema.safeParse(JSON.parse(jsonStr))
        if (parsed.success) {
          emitSignal(parsed.data)
        }
      } catch {
        // Ignore malformed SSE frames.
      }
    }
  }

  return remainder
}

/**
 * Authenticated streaming-fetch SSE client (`GET /api/pos/v1/signals`) using Bearer header
 * (never `EventSource` and never tokens in query strings), reconnecting cleanly with jitter
 * on silence (> 90s) or stream termination.
 */
export function createSignalsClient(opts: SseClientOptions): SseClientController {
  const fetchFn = opts.fetch ?? globalThis.fetch
  const rng = opts.rng ?? (() => 0.5)
  const silenceMs = opts.silenceTimeoutMs ?? SIGNAL_SILENCE_TIMEOUT_MS
  const setTimer = opts.setTimeoutFn ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const clearTimer =
    opts.clearTimeoutFn ??
    ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>))

  let stopped = false
  let activeAbort: AbortController | null = null
  let reconnectTimer: unknown = null
  let silenceTimer: unknown = null
  let failureCount = 0

  function clearTimers() {
    if (reconnectTimer !== null) {
      clearTimer(reconnectTimer)
      reconnectTimer = null
    }
    if (silenceTimer !== null) {
      clearTimer(silenceTimer)
      silenceTimer = null
    }
  }

  function nextReconnectDelayMs(explicitMs?: number): number {
    if (explicitMs !== undefined) return explicitMs
    const exp = Math.min(
      SIGNAL_MAX_RECONNECT_MS,
      SIGNAL_MIN_RECONNECT_MS * 2 ** Math.min(failureCount, 6),
    )
    const jitter = 0.8 + Math.max(0, Math.min(1, rng())) * 0.4
    return Math.round(exp * jitter)
  }

  function scheduleReconnect(explicitMs?: number) {
    if (stopped) return
    clearTimers()
    const delay = nextReconnectDelayMs(explicitMs)
    failureCount += 1
    reconnectTimer = setTimer(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  async function connect(): Promise<void> {
    if (stopped || !opts.db.isOpen()) return
    let device: Awaited<ReturnType<typeof getMeta<'device'>>>
    try {
      device = await getMeta(opts.db, 'device')
    } catch {
      return
    }
    if (!device || stopped) {
      return
    }

    const abort = new AbortController()
    activeAbort = abort

    const armSilence = () => {
      if (silenceTimer !== null) {
        clearTimer(silenceTimer)
      }
      silenceTimer = setTimer(() => {
        abort.abort()
      }, silenceMs)
    }

    try {
      const res = await fetchFn('/api/pos/v1/signals', {
        method: 'GET',
        headers: new Headers({
          Authorization: `Bearer ${device.credential}`,
          Accept: 'text/event-stream',
          [HEADER_APP_VERSION]: APP_VERSION,
          [HEADER_SCHEMA_VERSION]: String(SCHEMA_VERSION),
          [HEADER_SYNC_PROTOCOL]: String(SYNC_PROTOCOL_VERSION),
        }),
        cache: 'no-store',
        signal: abort.signal,
      })

      if (res.status === 429) {
        const retrySec = Number(res.headers.get('Retry-After') ?? '30')
        const ms = Number.isFinite(retrySec) && retrySec > 0 ? retrySec * 1_000 : 30_000
        scheduleReconnect(ms)
        return
      }

      if (res.status === 401 || res.status === 403) {
        // Check if terminal auth code vs transient proxy rejection
        try {
          const errJson = (await res.json()) as { error?: { code?: string } }
          const code = errJson.error?.code
          if (code === 'DEVICE_REVOKED' || code === 'CREDENTIAL_EXPIRED') {
            opts.onAuthTerminal?.()
            return
          }
        } catch {
          // Treat HTML/non-JSON 401/403 as transient reconnect
        }
        scheduleReconnect()
        return
      }

      if (!res.ok || !res.body) {
        scheduleReconnect()
        return
      }

      failureCount = 0
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      armSilence()
      while (!stopped) {
        const { done, value } = await reader.read()
        if (done) break
        armSilence()
        buffer = parseSseChunk(buffer + decoder.decode(value, { stream: true }), opts.onSignal)
      }

      scheduleReconnect()
    } catch {
      if (!stopped) {
        scheduleReconnect()
      }
    } finally {
      if (silenceTimer !== null) {
        clearTimer(silenceTimer)
        silenceTimer = null
      }
      if (activeAbort === abort) {
        activeAbort = null
      }
    }
  }

  return {
    start() {
      stopped = false
      void connect()
    },
    stop() {
      stopped = true
      clearTimers()
      activeAbort?.abort()
      activeAbort = null
    },
  }
}
