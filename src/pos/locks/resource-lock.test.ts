import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeLockManager } from '../../../tests/helpers/fake-locks'
import {
  __resetResourceLockFallbackWarningForTests,
  withResourceLock,
} from './resource-lock'

afterEach(() => {
  __resetResourceLockFallbackWarningForTests()
})

describe('pos/locks/resource-lock', () => {
  const T = '0192a000-0000-7000-8000-00000000a001'
  const D = '0192a000-0000-7000-8000-00000000d001'

  it('serializes critical sections via Web Locks without steal and uses shared name for print locks', async () => {
    const locks = new FakeLockManager()
    const order: string[] = []

    const p1 = withResourceLock({
      tenantId: T,
      deviceId: D,
      name: 'finalize:reg-1',
      locks,
      fn: async () => {
        order.push('start-1')
        await new Promise((r) => setTimeout(r, 15))
        order.push('end-1')
        return 1
      },
    })

    const p2 = withResourceLock({
      tenantId: T,
      deviceId: D,
      name: 'finalize:reg-1',
      locks,
      fn: async () => {
        order.push('start-2')
        order.push('end-2')
        return 2
      },
    })

    expect(await Promise.all([p1, p2])).toEqual([1, 2])
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
    expect(locks.history.every((h) => !h.options.steal)).toBe(true)

    await withResourceLock({
      tenantId: T,
      deviceId: D,
      name: 'print:usb-9',
      locks,
      fn: async () => undefined,
    })
    expect(locks.history.at(-1)?.name).toBe('print:usb-9')
  })

  it('falls back to an in-process mutex queue when navigator.locks is unavailable', async () => {
    const order: string[] = []
    const onFallback = vi.fn()

    const [a, b] = await Promise.all([
      withResourceLock({
        tenantId: T,
        deviceId: D,
        name: 'sync',
        locks: null,
        onFallback,
        fn: async () => {
          order.push('a1')
          await new Promise((r) => setTimeout(r, 10))
          order.push('a2')
          return 'a'
        },
      }),
      withResourceLock({
        tenantId: T,
        deviceId: D,
        name: 'sync',
        locks: null,
        onFallback,
        fn: async () => {
          order.push('b1')
          order.push('b2')
          return 'b'
        },
      }),
    ])

    expect([a, b]).toEqual(['a', 'b'])
    expect(order).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect(onFallback).toHaveBeenCalled()
  })
})
