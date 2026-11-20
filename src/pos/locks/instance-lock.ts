import { channelName, lockName } from './names'

export type InstanceLockState = 'init' | 'primary' | 'passive' | 'passive_stale' | 'released'

export type InstanceBroadcastMessage =
  | { type: 'alive'; ts: number }
  | { type: 'hello'; ts: number }
  | { type: 'promoted'; ts: number }
  | { type: 'locked'; ts: number }
  | { type: 'unlocked'; ts: number }
  | { type: 'update-ready'; ts: number }

export interface LockManagerLike {
  request<T>(
    name: string,
    options: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => Promise<T> | T,
  ): Promise<T>
}

export interface BroadcastChannelLike {
  postMessage(data: unknown): void
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  close(): void
}

export interface TimersLike {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(id: unknown): void
}

export interface CreateInstanceLockOptions {
  tenantId: string
  deviceId: string
  locks?: LockManagerLike | null
  channelFactory?: ((name: string) => BroadcastChannelLike | null) | null
  nowMs?: () => number
  timers?: TimersLike
  aliveIntervalMs?: number
  staleThresholdMs?: number
}

export interface InstanceLockHandle {
  readonly state: InstanceLockState
  acquire(): Promise<'primary' | 'passive'>
  sendMessage(msg: Omit<InstanceBroadcastMessage, 'ts'>): void
  onPromoted(cb: () => void): () => void
  onStateChange(cb: (state: InstanceLockState) => void): () => void
  onMessage(cb: (msg: InstanceBroadcastMessage) => void): () => void
  release(): void
}

export const DEFAULT_ALIVE_INTERVAL_MS = 5_000
export const DEFAULT_STALE_THRESHOLD_MS = 20_000

function defaultLocks(): LockManagerLike | null {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks as unknown as LockManagerLike
  }
  return null
}

function defaultChannelFactory(name: string): BroadcastChannelLike | null {
  if (typeof BroadcastChannel !== 'undefined') {
    return new BroadcastChannel(name)
  }
  return null
}

const defaultTimers: TimersLike = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
}

/**
 * Coordinates single-primary-tab per (tenantId, deviceId) via Web Locks (exclusive, no steal)
 * plus BroadcastChannel heartbeat so passive tabs can detect a stale/unresponsive primary tab.
 */
export function createInstanceLock(options: CreateInstanceLockOptions): InstanceLockHandle {
  const {
    tenantId,
    deviceId,
    nowMs = () => Date.now(),
    timers = defaultTimers,
    aliveIntervalMs = DEFAULT_ALIVE_INTERVAL_MS,
    staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
  } = options

  const locks = options.locks !== undefined ? options.locks : defaultLocks()
  const makeChannel =
    options.channelFactory !== undefined ? options.channelFactory : defaultChannelFactory

  const fullLockName = lockName(tenantId, deviceId)
  const fullChannelName = channelName(tenantId, deviceId)

  let currentState: InstanceLockState = 'init'
  let releasePrimaryHold: (() => void) | null = null
  let channel: BroadcastChannelLike | null = null
  let aliveTimer: unknown = null
  let staleTimer: unknown = null
  let lastAliveAt = nowMs()

  const promotedListeners = new Set<() => void>()
  const stateListeners = new Set<(state: InstanceLockState) => void>()
  const messageListeners = new Set<(msg: InstanceBroadcastMessage) => void>()

  function emitState(next: InstanceLockState) {
    if (currentState === next) return
    currentState = next
    for (const cb of stateListeners) {
      cb(next)
    }
  }

  function clearHeartbeatTimers() {
    if (aliveTimer !== null) {
      timers.clearInterval(aliveTimer)
      aliveTimer = null
    }
    if (staleTimer !== null) {
      timers.clearInterval(staleTimer)
      staleTimer = null
    }
  }

  function broadcast(msg: Omit<InstanceBroadcastMessage, 'ts'>) {
    if (!channel || currentState === 'released') return
    try {
      channel.postMessage({ ...msg, ts: nowMs() })
    } catch {
      // Ignore closed channel races during shutdown.
    }
  }

  function startPrimaryHeartbeat() {
    clearHeartbeatTimers()
    broadcast({ type: 'hello' })
    aliveTimer = timers.setInterval(() => {
      broadcast({ type: 'alive' })
    }, aliveIntervalMs)
  }

  function startPassiveWatchdog() {
    clearHeartbeatTimers()
    lastAliveAt = nowMs()
    const checkPeriod = Math.max(250, Math.min(1_000, Math.floor(staleThresholdMs / 4)))
    staleTimer = timers.setInterval(() => {
      if (currentState !== 'passive' && currentState !== 'passive_stale') return
      if (nowMs() - lastAliveAt > staleThresholdMs) {
        emitState('passive_stale')
      }
    }, checkPeriod)
  }

  function ensureChannelOpened() {
    if (channel || !makeChannel) return
    try {
      channel = makeChannel(fullChannelName)
    } catch {
      channel = null
      return
    }
    channel?.addEventListener('message', (ev) => {
      const data = ev.data as Partial<InstanceBroadcastMessage> | undefined
      if (!data || typeof data.type !== 'string') return

      if (data.type === 'alive' || data.type === 'hello' || data.type === 'promoted') {
        lastAliveAt = nowMs()
        if (currentState === 'passive_stale') {
          emitState('passive')
        }
      }

      const fullMsg = {
        type: data.type,
        ts: typeof data.ts === 'number' ? data.ts : nowMs(),
      } as InstanceBroadcastMessage
      for (const cb of messageListeners) {
        cb(fullMsg)
      }
    })
  }

  function waitUntilReleased(): Promise<void> {
    if (currentState === 'released') {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      releasePrimaryHold = resolve
    })
  }

  async function acquire(): Promise<'primary' | 'passive'> {
    if (currentState === 'released') {
      throw new Error('Cannot acquire an already released instance lock')
    }

    ensureChannelOpened()

    if (!locks) {
      emitState('primary')
      startPrimaryHeartbeat()
      return 'primary'
    }

    return new Promise<'primary' | 'passive'>((resolveInitial) => {
      let settled = false

      void locks
        .request(fullLockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
          if (lock) {
            emitState('primary')
            startPrimaryHeartbeat()
            if (!settled) {
              settled = true
              resolveInitial('primary')
            }
            await waitUntilReleased()
            return
          }

          emitState('passive')
          startPassiveWatchdog()
          if (!settled) {
            settled = true
            resolveInitial('passive')
          }

          // Immediately enqueue a blocking request (never `steal: true`) to promote when primary closes.
          void locks.request(fullLockName, { mode: 'exclusive' }, async () => {
            if (currentState === 'released') {
              return
            }
            emitState('primary')
            startPrimaryHeartbeat()
            broadcast({ type: 'promoted' })
            for (const cb of promotedListeners) {
              cb()
            }
            await waitUntilReleased()
          })
        })
        .catch(() => {
          if (!settled) {
            settled = true
            emitState('primary')
            startPrimaryHeartbeat()
            resolveInitial('primary')
          }
        })
    })
  }

  function release() {
    if (currentState === 'released') return
    emitState('released')
    clearHeartbeatTimers()
    releasePrimaryHold?.()
    releasePrimaryHold = null
    try {
      channel?.close()
    } catch {
      // Ignore close errors.
    }
    channel = null
  }

  return {
    get state() {
      return currentState
    },
    acquire,
    sendMessage(msg) {
      broadcast(msg)
    },
    onPromoted(cb) {
      promotedListeners.add(cb)
      return () => {
        promotedListeners.delete(cb)
      }
    },
    onStateChange(cb) {
      stateListeners.add(cb)
      return () => {
        stateListeners.delete(cb)
      }
    },
    onMessage(cb) {
      messageListeners.add(cb)
      return () => {
        messageListeners.delete(cb)
      }
    },
    release,
  }
}
