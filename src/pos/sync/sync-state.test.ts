import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  deriveSyncIndicator,
  MAX_VISIBLE_BANNERS,
  type SyncState,
} from './sync-state'

const connArb = fc.constantFrom<SyncState['conn']>(
  'OFFLINE',
  'PROBING',
  'ONLINE_IDLE',
  'SYNCING',
  'UNSTABLE',
)
const deviceArb = fc.constantFrom<SyncState['device']>('OK', 'LEASE_WARNING', 'LOCKED')
const updateArb = fc.constantFrom<SyncState['update']>(
  'NONE',
  'AVAILABLE',
  'PENDING_APPLY',
  'REQUIRED',
)

describe('pos/sync/sync-state (deriveSyncIndicator properties)', () => {
  it('always respects priority invariants, additive pending badge, and <= 2 stacked banners across all state combinations', () => {
    const stateArb: fc.Arbitrary<SyncState> = fc.record({
      conn: connArb,
      queue: fc.record({
        pending: fc.integer({ min: 0, max: 50 }),
        oldestAt: fc.constantFrom(null, '2026-11-20T01:00:00.000Z'),
        attention: fc.integer({ min: 0, max: 10 }),
      }),
      device: deviceArb,
      leaseHoursLeft: fc.constantFrom(undefined, 1, 12, 24),
      update: updateArb,
      lastSuccessAt: fc.constantFrom(null, '2026-11-20T05:00:00.000Z'),
      clockWarning: fc.boolean(),
      syncingSinceMs: fc.constantFrom(null, 1_000, 1_900),
    })

    const NOW = 2_000

    fc.assert(
      fc.property(stateArb, (s) => {
        const out = deriveSyncIndicator(s, NOW)

        expect(out.banners.length).toBeLessThanOrEqual(MAX_VISIBLE_BANNERS)

        if (s.queue.pending > 0) {
          expect(out.pendingBadge).toEqual({
            count: s.queue.pending,
            oldestAt: s.queue.oldestAt,
          })
        } else {
          expect(out.pendingBadge).toBeNull()
        }

        if (s.device === 'LOCKED') {
          expect(out.primary).toBe('device_locked')
        } else if (s.queue.attention > 0) {
          expect(out.primary).toBe('needs_attention')
        } else if (
          s.conn === 'SYNCING' &&
          s.syncingSinceMs !== null &&
          NOW - s.syncingSinceMs > 400
        ) {
          expect(out.primary).toBe('syncing')
        } else if (s.conn === 'OFFLINE' || s.conn === 'UNSTABLE') {
          expect(out.primary).toBe('offline')
        } else if (s.lastSuccessAt !== null) {
          expect(out.primary).toBe('synced')
        } else {
          expect(out.primary).toBe('online')
        }
      }),
      { numRuns: 300 },
    )
  })
})
