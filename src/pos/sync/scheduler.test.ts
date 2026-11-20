import { afterEach, describe, expect, it } from 'vitest'
import { FakeLockManager } from '../../../tests/helpers/fake-locks'
import { getMeta } from '../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { createSyncClock } from './clock'
import type { ConnectivityMonitor } from './connectivity'
import { createSyncScheduler } from './scheduler'

const T1 = '0192a000-0000-7000-8000-00000000a001'
const DEV_1 = '0192a000-0000-7000-8000-00000000d001'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

function mockConnectivity(): ConnectivityMonitor {
  return {
    state: 'ONLINE_IDLE',
    consecutiveFailures: 0,
    isUnstable: () => false,
    probeNow: async () => 'ONLINE_IDLE',
    handleBrowserOnline: () => {},
    handleBrowserOffline: () => {},
    markSyncing: () => {},
    reportHttpSuccess: () => {},
    reportHttpTransportFailure: () => {},
    reportRateLimited: () => {},
    start: () => {},
    stop: () => {},
  }
}

describe('pos/sync/scheduler', () => {
  it('coalesces overlapping triggers, guarantees single-flight via sync lock, and updates last_success_sync_at only on full success', async () => {
    const db = await openTenantDb(T1)
    const locks = new FakeLockManager()
    const clock = createSyncClock({
      db,
      nowMs: () => Date.UTC(2026, 10, 20, 8, 0, 0),
    })

    let concurrentCount = 0
    let maxConcurrent = 0
    let cycleRunCount = 0

    const scheduler = createSyncScheduler({
      db,
      tenantId: T1,
      deviceId: DEV_1,
      clock,
      connectivity: mockConnectivity(),
      locks,
      runPushStep: async () => {
        concurrentCount += 1
        maxConcurrent = Math.max(maxConcurrent, concurrentCount)
        cycleRunCount += 1
        await new Promise((r) => setTimeout(r, 15))
        concurrentCount -= 1
        return {
          kind: 'ok',
          pushOk: cycleRunCount >= 2, // 1st run has transient/RETRY; 2nd run succeeds fully
          serverTimeMs: Date.UTC(2026, 10, 20, 8, 0, 5),
        }
      },
      runPullStep: async () => ({
        kind: 'ok',
        serverTimeMs: Date.UTC(2026, 10, 20, 8, 0, 10),
      }),
      runFullResyncStep: async () => ({ kind: 'ok' }),
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    })

    // Launch first cycle, then immediately fire multiple kicks while it runs -> coalesced into 1 trailing run!
    const p1 = scheduler.runNowForTests()
    scheduler.kick('signal')
    scheduler.kick('focus')
    scheduler.kick('finalized')
    await p1

    expect(maxConcurrent).toBe(1)
    expect(cycleRunCount).toBe(2)
    expect(await getMeta(db, 'last_success_sync_at')).toBe('2026-11-20T08:00:10.000Z')
    expect(locks.history.every((h) => !h.options.steal)).toBe(true)

    scheduler.stop()
  })
})
