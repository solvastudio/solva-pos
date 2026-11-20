export interface FakeLockRequestOptions {
  mode?: 'exclusive' | 'shared'
  ifAvailable?: boolean
  steal?: boolean
}

export interface FakeBroadcastMessageEvent {
  data: unknown
}

export interface FakeBroadcastChannelLike {
  name: string
  postMessage(data: unknown): void
  addEventListener(type: 'message', listener: (ev: FakeBroadcastMessageEvent) => void): void
  removeEventListener(type: 'message', listener: (ev: FakeBroadcastMessageEvent) => void): void
  close(): void
}

interface PendingWaiter {
  name: string
  cb: (lock: { name: string } | null) => Promise<unknown> | unknown
  resolveOuter: (val: unknown) => void
  rejectOuter: (err: unknown) => void
}

/**
 * Deterministic in-memory Web Locks implementation for tests.
 * Tracks all request options (explicitly allowing assertions that `steal` is never set).
 */
export class FakeLockManager {
  readonly history: Array<{ name: string; options: FakeLockRequestOptions }> = []
  private readonly activeLocks = new Set<string>()
  private readonly queues = new Map<string, PendingWaiter[]>()

  request<T = unknown>(
    name: string,
    optionsOrCb: FakeLockRequestOptions | ((lock: { name: string } | null) => Promise<T> | T),
    maybeCb?: (lock: { name: string } | null) => Promise<T> | T,
  ): Promise<T> {
    const options: FakeLockRequestOptions =
      typeof optionsOrCb === 'function' ? { mode: 'exclusive' } : optionsOrCb
    const cb = (typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb)!

    this.history.push({ name, options })

    if (options.steal) {
      throw new Error('steal:true is forbidden by Solva lock policy')
    }

    if (!this.activeLocks.has(name)) {
      return this.runGranted(name, cb) as Promise<T>
    }

    if (options.ifAvailable) {
      return Promise.resolve().then(() => cb(null))
    }

    return new Promise<T>((resolveOuter, rejectOuter) => {
      const q = this.queues.get(name) ?? []
      q.push({
        name,
        cb: cb as (lock: { name: string } | null) => Promise<unknown> | unknown,
        resolveOuter: resolveOuter as (val: unknown) => void,
        rejectOuter,
      })
      this.queues.set(name, q)
    })
  }

  private async runGranted(
    name: string,
    cb: (lock: { name: string } | null) => Promise<unknown> | unknown,
  ): Promise<unknown> {
    this.activeLocks.add(name)
    try {
      return await cb({ name })
    } finally {
      this.activeLocks.delete(name)
      this.drainNext(name)
    }
  }

  private drainNext(name: string): void {
    const q = this.queues.get(name)
    if (!q || q.length === 0) return
    const next = q.shift()!
    if (q.length === 0) {
      this.queues.delete(name)
    }
    this.runGranted(next.name, next.cb).then(next.resolveOuter, next.rejectOuter)
  }

  isLocked(name: string): boolean {
    return this.activeLocks.has(name)
  }
}

/**
 * Shared in-memory hub producing linked `BroadcastChannel` instances for multi-tab tests.
 */
export class FakeBroadcastHub {
  private readonly channels = new Map<string, Set<FakeBroadcastChannelInstance>>()

  open(name: string): FakeBroadcastChannelLike {
    const instance = new FakeBroadcastChannelInstance(name, this)
    const set = this.channels.get(name) ?? new Set()
    set.add(instance)
    this.channels.set(name, set)
    return instance
  }

  dispatch(sender: FakeBroadcastChannelInstance, name: string, data: unknown): void {
    const peers = this.channels.get(name)
    if (!peers) return
    for (const peer of peers) {
      if (peer === sender || peer.closed) continue
      peer.deliver(data)
    }
  }

  unregister(instance: FakeBroadcastChannelInstance, name: string): void {
    this.channels.get(name)?.delete(instance)
  }
}

class FakeBroadcastChannelInstance implements FakeBroadcastChannelLike {
  closed = false
  private readonly listeners = new Set<(ev: FakeBroadcastMessageEvent) => void>()

  constructor(
    readonly name: string,
    private readonly hub: FakeBroadcastHub,
  ) {}

  postMessage(data: unknown): void {
    if (this.closed) return
    this.hub.dispatch(this, this.name, data)
  }

  deliver(data: unknown): void {
    if (this.closed) return
    for (const listener of this.listeners) {
      listener({ data })
    }
  }

  addEventListener(type: 'message', listener: (ev: FakeBroadcastMessageEvent) => void): void {
    if (type !== 'message') return
    this.listeners.add(listener)
  }

  removeEventListener(type: 'message', listener: (ev: FakeBroadcastMessageEvent) => void): void {
    if (type !== 'message') return
    this.listeners.delete(listener)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    this.hub.unregister(this, this.name)
  }
}
