import { describe, expect, it } from 'vitest'
import type { SolvaDb } from '../db/solva-db'
import type { BootResult } from './boot'
import { decideRoute } from './route-decision'

const dummyReadyBase = {
  kind: 'READY' as const,
  db: {} as SolvaDb,
  tenantId: '0192a000-0000-7000-8000-00000000a001',
  slug: 'acme',
  locale: 'id-ID' as const,
  device: {
    device_id: 'd1',
    credential: 'c1',
    credential_expires_at: '2027-01-01T00:00:00.000Z',
    tenant_id: '0192a000-0000-7000-8000-00000000a001',
    slug: 'acme',
    register_id: 'r1',
    outlet_id: 'o1',
    register_type: 'CASHIER' as const,
  },
  tenant: null,
  releaseLock: () => {},
}

describe('pos/boot/route-decision', () => {
  it('maps every BootResult and DeviceState variant cleanly', () => {
    const cases: Array<[BootResult, ReturnType<typeof decideRoute>]> = [
      [{ kind: 'NEEDS_PAIRING', reason: 'UNKNOWN_SLUG' }, { to: 'pair' }],
      [{ kind: 'PASSIVE_DUPLICATE', releaseLock: () => {} }, { to: 'system', variant: 'duplicate_instance' }],
      [{ kind: 'LOCAL_DB_FAILED', ref: 'D-20261120-010000-abcde' }, { to: 'system', variant: 'local_db_failed' }],
      [{ ...dummyReadyBase, state: { kind: 'UNPAIRED' } }, { to: 'pair' }],
      [{ ...dummyReadyBase, state: { kind: 'REVOKED' } }, { to: 'system', variant: 'revoked' }],
      [{ ...dummyReadyBase, state: { kind: 'CREDENTIAL_EXPIRED' } }, { to: 'system', variant: 'credential_expired' }],
      [{ ...dummyReadyBase, state: { kind: 'TENANT_SUSPENDED' } }, { to: 'system', variant: 'tenant_suspended' }],
      [{ ...dummyReadyBase, state: { kind: 'LOCKED_CLOCK' } }, { to: 'system', variant: 'clock_back' }],
      [{ ...dummyReadyBase, state: { kind: 'LOCKED_LEASE' } }, { to: 'system', variant: 'lease_expired' }],
      [{ ...dummyReadyBase, state: { kind: 'OK' } }, { to: 'login' }],
      [{ ...dummyReadyBase, state: { kind: 'LEASE_WARNING', hoursLeft: 12 } }, { to: 'login' }],
      [{ ...dummyReadyBase, state: { kind: 'UPDATE_REQUIRED' } }, { to: 'login' }],
    ]

    for (const [input, expected] of cases) {
      expect(decideRoute(input)).toEqual(expected)
    }
  })
})
