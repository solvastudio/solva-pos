import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSignalsHub } from './signals-hub'
import {
  publishBillsChanged,
  publishMasterChanged,
  subscribeBillsChanged,
  subscribeMasterChanged,
} from './signals'

describe('modules/sync/server/signals-hub', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('replaces previous connection for the same device, isolates tenants, coalesces master signals over 500ms, and sends 25s ping', () => {
    vi.useFakeTimers()
    const hub = createSignalsHub({
      subscribeMaster: subscribeMasterChanged,
      subscribeBills: subscribeBillsChanged,
    })

    const dev1EventsA: unknown[] = []
    const dev1ClosedA = vi.fn()
    const unreg1A = hub.register({
      deviceId: 'dev-1',
      tenantId: 'tenant-a',
      outletId: 'out-1',
      sendEvent: (m) => dev1EventsA.push(m),
      sendComment: () => {},
      close: dev1ClosedA,
    })

    // Second connection for dev-1 closes the first connection.
    const dev1EventsB: unknown[] = []
    const dev1PingsB: string[] = []
    const unreg1B = hub.register({
      deviceId: 'dev-1',
      tenantId: 'tenant-a',
      outletId: 'out-1',
      sendEvent: (m) => dev1EventsB.push(m),
      sendComment: (c) => dev1PingsB.push(c),
      close: () => {},
    })

    const dev2Events: unknown[] = []
    const unreg2 = hub.register({
      deviceId: 'dev-2',
      tenantId: 'tenant-b',
      outletId: 'out-1',
      sendEvent: (m) => dev2Events.push(m),
      sendComment: () => {},
      close: () => {},
    })

    const dev3OtherOutletEvents: unknown[] = []
    const unreg3 = hub.register({
      deviceId: 'dev-3',
      tenantId: 'tenant-a',
      outletId: 'out-2',
      sendEvent: (m) => dev3OtherOutletEvents.push(m),
      sendComment: () => {},
      close: () => {},
    })

    expect(dev1ClosedA).toHaveBeenCalledTimes(1)
    expect(hub.activeConnectionCount()).toBe(3)

    // Rapid master changes on tenant-a coalesce into one signal with highest version after 500ms.
    publishMasterChanged('tenant-a', 10)
    publishMasterChanged('tenant-a', 12)
    expect(dev1EventsB).toEqual([])

    vi.advanceTimersByTime(500)
    expect(dev1EventsB).toEqual([{ t: 'pull', v: 12 }])
    expect(dev3OtherOutletEvents).toEqual([{ t: 'pull', v: 12 }])
    expect(dev2Events).toEqual([])

    // Rapid bill changes on tenant-a/out-1 coalesce into one `{ t: 'bills' }` delivered ONLY to out-1.
    publishBillsChanged('tenant-a', 'out-1')
    publishBillsChanged('tenant-a', 'out-1')
    vi.advanceTimersByTime(500)
    expect(dev1EventsB).toEqual([{ t: 'pull', v: 12 }, { t: 'bills' }])
    expect(dev3OtherOutletEvents).toEqual([{ t: 'pull', v: 12 }])
    expect(dev2Events).toEqual([])

    // 25s heartbeat comment ping
    vi.advanceTimersByTime(25_000)
    expect(dev1PingsB).toEqual(['ping'])

    unreg1A()
    unreg1B()
    unreg2()
    unreg3()
    hub.resetForTests()
  })
})
