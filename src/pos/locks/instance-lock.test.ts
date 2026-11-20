import { describe, expect, it, vi } from 'vitest'
import { FakeBroadcastHub, FakeLockManager } from '../../../tests/helpers/fake-locks'
import { createInstanceLock, type InstanceLockState } from './instance-lock'

function createFakeTimers() {
  let nextId = 1
  const entries = new Map<number, { fn: () => void; ms: number; lastRun: number }>()
  let now = 1_000_000

  return {
    nowMs: () => now,
    timers: {
      setInterval(fn: () => void, ms: number) {
        const id = nextId
        nextId += 1
        entries.set(id, { fn, ms, lastRun: now })
        return id
      },
      clearInterval(id: unknown) {
        entries.delete(id as number)
      },
    },
    advanceBy(deltaMs: number) {
      const target = now + deltaMs
      while (now < target) {
        let nextTick = target
        for (const entry of entries.values()) {
          const due = entry.lastRun + entry.ms
          if (due < nextTick) {
            nextTick = due
          }
        }
        now = nextTick
        for (const entry of [...entries.values()]) {
          if (now - entry.lastRun >= entry.ms) {
            entry.lastRun = now
            entry.fn()
          }
        }
      }
    },
  }
}

describe('pos/locks/instance-lock', () => {
  const TENANT_A = '0192a000-0000-7000-8000-00000000a001'
  const TENANT_B = '0192a000-0000-7000-8000-00000000a002'
  const DEVICE_1 = '0192a000-0000-7000-8000-00000000d001'

  it('grants primary to tab 1, passive to tab 2, promotes tab 2 when tab 1 releases, and never calls steal', async () => {
    const locks = new FakeLockManager()
    const hub = new FakeBroadcastHub()
    const clk = createFakeTimers()

    const tab1 = createInstanceLock({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      locks,
      channelFactory: (n) => hub.open(n),
      nowMs: clk.nowMs,
      timers: clk.timers,
    })

    const tab2 = createInstanceLock({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      locks,
      channelFactory: (n) => hub.open(n),
      nowMs: clk.nowMs,
      timers: clk.timers,
    })

    const promotedSpy = vi.fn()
    tab2.onPromoted(promotedSpy)

    expect(await tab1.acquire()).toBe('primary')
    expect(await tab2.acquire()).toBe('passive')
    expect(tab1.state).toBe('primary')
    expect(tab2.state).toBe('passive')
    expect(promotedSpy).not.toHaveBeenCalled()

    // Release tab 1 -> tab 2 must be promoted cleanly to primary.
    tab1.release()
    await Promise.resolve()
    await Promise.resolve()

    expect(tab2.state).toBe('primary')
    expect(promotedSpy).toHaveBeenCalledTimes(1)
    expect(locks.history.every((h) => !h.options.steal)).toBe(true)

    tab2.release()
  })

  it('isolates different tenants on the same device so both acquire primary', async () => {
    const locks = new FakeLockManager()
    const hub = new FakeBroadcastHub()
    const clk = createFakeTimers()

    const lockA = createInstanceLock({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      locks,
      channelFactory: (n) => hub.open(n),
      nowMs: clk.nowMs,
      timers: clk.timers,
    })

    const lockB = createInstanceLock({
      tenantId: TENANT_B,
      deviceId: DEVICE_1,
      locks,
      channelFactory: (n) => hub.open(n),
      nowMs: clk.nowMs,
      timers: clk.timers,
    })

    expect(await lockA.acquire()).toBe('primary')
    expect(await lockB.acquire()).toBe('primary')

    lockA.release()
    lockB.release()
  })

  it('marks passive tab passive_stale when alive heartbeat stops for more than 20 seconds', async () => {
    const locks = new FakeLockManager()
    const hub = new FakeBroadcastHub()
    const clk = createFakeTimers()

    const tab1 = createInstanceLock({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      locks,
      channelFactory: (n) => hub.open(n),
      nowMs: clk.nowMs,
      timers: clk.timers,
    })

    // Simulate a silent peer channel for tab2 by withholding alive heartbeats after acquire.
    let suppressAlive = false
    const tab2 = createInstanceLock({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      locks,
      channelFactory: (n) => {
        const ch = hub.open(n)
        return {
          postMessage: (d) => ch.postMessage(d),
          addEventListener: (type, listener) =>
            ch.addEventListener(type, (ev) => {
              if (!suppressAlive) listener(ev)
            }),
          removeEventListener: (type, listener) => ch.removeEventListener(type, listener),
          close: () => ch.close(),
        }
      },
      nowMs: clk.nowMs,
      timers: clk.timers,
    })

    const states: InstanceLockState[] = []
    tab2.onStateChange((s) => states.push(s))

    await tab1.acquire()
    await tab2.acquire()

    // Stop delivering heartbeats and advance fake clock 21 seconds.
    suppressAlive = true
    clk.advanceBy(21_000)

    expect(tab2.state).toBe('passive_stale')
    expect(states).toContain('passive_stale')

    tab1.release()
    tab2.release()
  })
})
