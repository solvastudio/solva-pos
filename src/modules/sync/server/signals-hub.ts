import '@tanstack/react-start/server-only'
import type { SignalMessage } from '~/lib/contracts'
import { subscribeMasterChanged } from './signals'

export interface SignalConnection {
  deviceId: string
  tenantId: string
  sendEvent: (msg: SignalMessage) => void
  sendComment: (comment: string) => void
  close: () => void
}

export interface SignalTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
}

const defaultTimers: SignalTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
}

export const DEFAULT_SIGNAL_COALESCE_MS = 500
export const DEFAULT_SIGNAL_PING_MS = 25_000

interface TenantSignalState {
  deviceIds: Set<string>
  unsubscribeMaster: () => void
  pendingVersion: number | null
  coalesceTimer: unknown
}

export interface SignalsHub {
  register(conn: SignalConnection): () => void
  broadcastTenant(tenantId: string, msg: SignalMessage): void
  activeConnectionCount(): number
  resetForTests(): void
}

export function createSignalsHub(options?: {
  coalesceMs?: number
  pingIntervalMs?: number
  timers?: SignalTimers
  subscribeMaster?: typeof subscribeMasterChanged
}): SignalsHub {
  const coalesceMs = options?.coalesceMs ?? DEFAULT_SIGNAL_COALESCE_MS
  const pingIntervalMs = options?.pingIntervalMs ?? DEFAULT_SIGNAL_PING_MS
  const timers = options?.timers ?? defaultTimers
  const subscribeMaster = options?.subscribeMaster ?? subscribeMasterChanged

  const byDevice = new Map<string, { conn: SignalConnection; pingTimer: unknown }>()
  const byTenant = new Map<string, TenantSignalState>()

  function broadcastTenant(tenantId: string, msg: SignalMessage): void {
    const tKey = tenantId.toLowerCase()
    const tState = byTenant.get(tKey)
    if (!tState) return
    for (const devId of [...tState.deviceIds]) {
      const active = byDevice.get(devId)
      if (!active) continue
      try {
        active.conn.sendEvent(msg)
      } catch {
        // Ignore broken streams waiting for cancel().
      }
    }
  }

  function ensureTenantWatcher(tenantId: string): TenantSignalState {
    const tKey = tenantId.toLowerCase()
    const existing = byTenant.get(tKey)
    if (existing) return existing

    const state: TenantSignalState = {
      deviceIds: new Set<string>(),
      pendingVersion: null,
      coalesceTimer: null,
      unsubscribeMaster: () => {},
    }

    state.unsubscribeMaster = subscribeMaster(tKey, (version) => {
      state.pendingVersion =
        state.pendingVersion === null ? version : Math.max(state.pendingVersion, version)
      if (state.coalesceTimer !== null) return
      state.coalesceTimer = timers.setTimeout(() => {
        state.coalesceTimer = null
        const latest = state.pendingVersion
        state.pendingVersion = null
        if (latest !== null) {
          broadcastTenant(tKey, { t: 'pull', v: latest })
        }
      }, coalesceMs)
    })

    byTenant.set(tKey, state)
    return state
  }

  function cleanupDevice(deviceId: string, expectedConn: SignalConnection): void {
    const current = byDevice.get(deviceId)
    if (!current || current.conn !== expectedConn) {
      return
    }
    timers.clearInterval(current.pingTimer)
    byDevice.delete(deviceId)

    const tKey = expectedConn.tenantId.toLowerCase()
    const tState = byTenant.get(tKey)
    if (tState) {
      tState.deviceIds.delete(deviceId)
      if (tState.deviceIds.size === 0) {
        if (tState.coalesceTimer !== null) {
          timers.clearTimeout(tState.coalesceTimer)
          tState.coalesceTimer = null
        }
        tState.unsubscribeMaster()
        byTenant.delete(tKey)
      }
    }
  }

  function register(conn: SignalConnection): () => void {
    const previous = byDevice.get(conn.deviceId)
    if (previous) {
      timers.clearInterval(previous.pingTimer)
      cleanupDevice(conn.deviceId, previous.conn)
      try {
        previous.conn.close()
      } catch {
        // Previous stream may already be closing.
      }
    }

    const tState = ensureTenantWatcher(conn.tenantId)
    tState.deviceIds.add(conn.deviceId)

    const pingTimer = timers.setInterval(() => {
      try {
        conn.sendComment('ping')
      } catch {
        // Ignore broken streams until stream cancel cleans up.
      }
    }, pingIntervalMs)

    byDevice.set(conn.deviceId, { conn, pingTimer })

    return () => {
      cleanupDevice(conn.deviceId, conn)
    }
  }

  function resetForTests(): void {
    for (const entry of byDevice.values()) {
      timers.clearInterval(entry.pingTimer)
      try {
        entry.conn.close()
      } catch {
        // Ignore close errors.
      }
    }
    byDevice.clear()
    for (const tState of byTenant.values()) {
      if (tState.coalesceTimer !== null) {
        timers.clearTimeout(tState.coalesceTimer)
      }
      tState.unsubscribeMaster()
    }
    byTenant.clear()
  }

  return {
    register,
    broadcastTenant,
    activeConnectionCount: () => byDevice.size,
    resetForTests,
  }
}

let defaultHub: SignalsHub | null = null

export function getSignalsHub(): SignalsHub {
  if (!defaultHub) {
    defaultHub = createSignalsHub()
  }
  return defaultHub
}
