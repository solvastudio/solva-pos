import { afterEach, describe, expect, it, vi } from 'vitest'
import { setMeta } from '../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { createSignalsClient, parseSseChunk } from './signals'

const T1 = '0192a000-0000-7000-8000-00000000a001'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

describe('pos/sync/signals (SSE fetch client)', () => {
  it('parses chunked SSE data frames ignoring heartbeats and malformed lines', () => {
    const received: unknown[] = []
    let rem: string
    rem = parseSseChunk(': ping\n\ndata: {"t":"pu', (m) => received.push(m))
    expect(received).toEqual([])
    rem = parseSseChunk(`${rem}ll","v":42}\n\ndata: {"t":"bills"}\n\n`, (m) => received.push(m))
    expect(rem).toBe('')
    expect(received).toEqual([
      { t: 'pull', v: 42 },
      { t: 'bills' },
    ])
  })

  it('connects with Bearer Authorization header and reconnects cleanly after stream EOF', async () => {
    const db = await openTenantDb(T1)
    await setMeta(db, 'device', {
      device_id: 'dev-1',
      credential: 'sse-secret-cred',
      credential_expires_at: '2027-01-01T00:00:00.000Z',
      tenant_id: T1,
      slug: 'acme',
      register_id: 'reg-1',
      outlet_id: 'out-1',
      register_type: 'CASHIER',
    })

    const received: unknown[] = []
    let callCount = 0
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      callCount += 1
      expect(url).toBe('/api/pos/v1/signals')
      const headers = init.headers as Headers
      expect(headers.get('authorization')).toBe('Bearer sse-secret-cred')

      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          if (callCount === 1) {
            ctrl.enqueue(encoder.encode('data: {"t":"pull","v":7}\n\n'))
            ctrl.close()
          } else {
            ctrl.enqueue(encoder.encode(': connected\n\n'))
            ctrl.close()
          }
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })

    let timerCb: (() => void) | null = null
    const client = createSignalsClient({
      db,
      fetch: mockFetch as unknown as typeof fetch,
      onSignal: (m) => received.push(m),
      setTimeoutFn: (fn, ms) => {
        if (ms < 5_000) timerCb = fn
        return 1
      },
      clearTimeoutFn: () => {},
    })

    client.start()
    await vi.waitFor(() => {
      expect(received).toEqual([{ t: 'pull', v: 7 }])
    })
    expect(timerCb).not.toBeNull()
    timerCb!()
    await vi.waitFor(() => {
      expect(callCount).toBe(2)
    })
    client.stop()
  })
})
