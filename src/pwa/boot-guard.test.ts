import { describe, expect, it } from 'vitest'
import {
  bootFailStorageKey,
  clearBootCrashHistory,
  onBootFailure,
  recordBootCrashTimestamp,
} from './boot-guard'

describe('pwa/boot-guard', () => {
  it('follows escalation table for count 1, 2, and >= 3 across lastGood DB compatibility', () => {
    const cases: Array<{
      label: string
      count: number
      lastGood?: { dexieVersion: number } | null
      clientDbVersion?: number
      expected: string
    }> = [
      { label: 'count 0 -> RETRY', count: 0, expected: 'RETRY' },
      { label: 'count 1 -> RETRY', count: 1, expected: 'RETRY' },
      {
        label: 'count 2 + compatible lastGood -> USE_LAST_GOOD',
        count: 2,
        lastGood: { dexieVersion: 2 },
        clientDbVersion: 2,
        expected: 'USE_LAST_GOOD',
      },
      {
        label: 'count 2 + higher lastGood dexieVersion -> USE_LAST_GOOD',
        count: 2,
        lastGood: { dexieVersion: 3 },
        clientDbVersion: 2,
        expected: 'USE_LAST_GOOD',
      },
      {
        label: 'count 2 + older lastGood dexieVersion -> RECOVERY',
        count: 2,
        lastGood: { dexieVersion: 1 },
        clientDbVersion: 2,
        expected: 'RECOVERY',
      },
      {
        label: 'count 2 + missing lastGood -> RECOVERY',
        count: 2,
        lastGood: null,
        clientDbVersion: 1,
        expected: 'RECOVERY',
      },
      {
        label: 'count 3 + compatible lastGood -> RECOVERY',
        count: 3,
        lastGood: { dexieVersion: 2 },
        clientDbVersion: 2,
        expected: 'RECOVERY',
      },
    ]

    for (const tc of cases) {
      expect(onBootFailure(tc.count, tc.lastGood, tc.clientDbVersion), tc.label).toBe(tc.expected)
    }
  })

  it('tracks root crashes inside a 60s window and resets cleanly', () => {
    const store = new Map<string, string>()
    const fakeStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
    }

    expect(bootFailStorageKey('t1')).toBe('solva:t1:bootfail')
    expect(recordBootCrashTimestamp('t1', 100_000, fakeStorage)).toEqual({
      count: 1,
      shouldRecover: false,
    })
    expect(recordBootCrashTimestamp('t1', 120_000, fakeStorage)).toEqual({
      count: 2,
      shouldRecover: true,
    })

    clearBootCrashHistory('t1', fakeStorage)
    expect(recordBootCrashTimestamp('t1', 200_000, fakeStorage)).toEqual({
      count: 1,
      shouldRecover: false,
    })
  })
})
