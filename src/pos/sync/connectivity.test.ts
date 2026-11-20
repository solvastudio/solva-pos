import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectivityMonitor } from './connectivity'

function pingOkResponse(serverTime = 1_795_095_855_000) {
  return new Response(JSON.stringify({ ok: true, server_time: serverTime }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-App-Version': 'v1.0.0',
    },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('pos/sync/connectivity', () => {
  it('rejects HTTP 200 captive portal HTML without X-App-Version and enforces 2-fail hysteresis + 429 neutrality', async () => {
    let failCount = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      failCount += 1
      if (failCount === 1) {
        // Captive portal HTML 200 without X-App-Version -> failure #1 (still not OFFLINE yet)
        return new Response('<html>Portal Login</html>', { status: 200 })
      }
      if (failCount === 2) {
        // 429 rate limited -> neutral, MUST NOT count toward failure #2
        return new Response('{}', { status: 429 })
      }
      if (failCount === 3) {
        // Second real failure -> ONLINE -> OFFLINE transition
        throw new Error('network down')
      }
      return pingOkResponse()
    })

    const mon = createConnectivityMonitor({
      fetch: fetchMock as unknown as typeof fetch,
      isNavigatorOnline: () => true,
    })

    // First make it online cleanly? Let's test 1 failure when online:
    const monOnline = createConnectivityMonitor({
      fetch: vi
        .fn()
        .mockResolvedValueOnce(pingOkResponse())
        .mockResolvedValueOnce(new Response('<html>Portal</html>', { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status: 429 }))
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce(pingOkResponse()) as unknown as typeof fetch,
      isNavigatorOnline: () => true,
    })

    expect(await monOnline.probeNow()).toBe('ONLINE_IDLE')
    // Failure 1 (captive portal) -> hysteresis keeps ONLINE_IDLE
    expect(await monOnline.probeNow()).toBe('ONLINE_IDLE')
    // 429 -> neutral
    expect(await monOnline.probeNow()).toBe('ONLINE_IDLE')
    // Failure 2 -> drops to OFFLINE
    expect(await monOnline.probeNow()).toBe('OFFLINE')
    // 1 success recovers directly to ONLINE_IDLE
    expect(await monOnline.probeNow()).toBe('ONLINE_IDLE')

    mon.stop()
    monOnline.stop()
  })

  it('enters UNSTABLE on >= 3 state transitions within 2 minutes and stays unstable for 60s', async () => {
    let now = 1_000_000
    let shouldOk = false
    const fetchMock = vi.fn().mockImplementation(async () => {
      if (shouldOk) return pingOkResponse()
      throw new Error('offline')
    })

    const mon = createConnectivityMonitor({
      fetch: fetchMock as unknown as typeof fetch,
      nowMs: () => now,
      isNavigatorOnline: () => true,
    })

    // Baseline ONLINE_IDLE -> 3 real transitions in < 2min trigger UNSTABLE
    shouldOk = true
    await mon.probeNow() // baseline ONLINE_IDLE
    now += 10_000
    shouldOk = false
    await mon.probeNow()
    await mon.probeNow() // OFFLINE (transition #1)
    now += 10_000
    shouldOk = true
    await mon.probeNow() // ONLINE_IDLE (transition #2)
    now += 10_000
    shouldOk = false
    await mon.probeNow()
    await mon.probeNow() // OFFLINE (transition #3 -> unstable window starts)
    now += 10_000
    shouldOk = true
    await mon.probeNow() // UNSTABLE while within 60s stabilize window!
    expect(mon.state).toBe('UNSTABLE')
    expect(mon.isUnstable()).toBe(true)

    // After 60s stability window expires, next probe recovers to ONLINE_IDLE.
    now += 61_000
    expect(await mon.probeNow()).toBe('ONLINE_IDLE')
    mon.stop()
  })
})
