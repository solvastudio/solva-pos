import { describe, expect, it } from 'vitest'
import {
  CLOCK_BACK_TOLERANCE_MS,
  computeDeviceState,
  LEASE_MS,
  LEASE_WARNING_MS,
  trustedNowMs,
} from './device-state'

describe('pos/session/device-state', () => {
  it('enforces priority order, exact 7-day lease (V-35), clock-back 4:59 vs 5:01, and warning hours', () => {
    const tSync = Date.UTC(2026, 10, 30, 13, 0, 0) // 30 Nov 20:00 WIB

    expect(
      trustedNowMs({ nowMs: 1_000_000, clockOffsetMs: 5_000, maxSeenMs: 2_000_000 }),
    ).toBe(1_005_000)

    expect(
      computeDeviceState({
        hasDevice: false,
        trustedNowMs: tSync,
        lastSuccessSyncAtMs: tSync,
        maxSeenTimeMs: tSync,
        flags: { revoked: true },
      }),
    ).toEqual({ kind: 'UNPAIRED' })

    expect(
      computeDeviceState({
        hasDevice: true,
        trustedNowMs: tSync,
        lastSuccessSyncAtMs: tSync - LEASE_MS - 1,
        maxSeenTimeMs: tSync,
        flags: { revoked: true, credentialExpired: true, tenantSuspended: true },
      }),
    ).toEqual({ kind: 'REVOKED' })

    expect(
      computeDeviceState({
        hasDevice: true,
        trustedNowMs: tSync,
        lastSuccessSyncAtMs: tSync - LEASE_MS - 1,
        maxSeenTimeMs: tSync,
        flags: { credentialExpired: true, tenantSuspended: true },
      }),
    ).toEqual({ kind: 'CREDENTIAL_EXPIRED' })

    expect(
      computeDeviceState({
        hasDevice: true,
        trustedNowMs: tSync,
        lastSuccessSyncAtMs: tSync,
        maxSeenTimeMs: tSync,
        flags: { tenantSuspended: true },
      }),
    ).toEqual({ kind: 'TENANT_SUSPENDED' })

    // V-35: last sync 30 Nov 20:00 WIB -> OK / LEASE_WARNING through 7 Dec 19:59, LOCKED_LEASE after 7 Dec 20:00
    expect(
      computeDeviceState({
        hasDevice: true,
        trustedNowMs: tSync + LEASE_WARNING_MS,
        lastSuccessSyncAtMs: tSync,
        maxSeenTimeMs: tSync,
      }),
    ).toEqual({ kind: 'OK' })

    expect(
      computeDeviceState({
        hasDevice: true,
        trustedNowMs: tSync + LEASE_MS - 60_000, // 7 Dec 19:59 WIB
        lastSuccessSyncAtMs: tSync,
        maxSeenTimeMs: tSync,
      }),
    ).toEqual({ kind: 'LEASE_WARNING', hoursLeft: 1 })

    expect(
      computeDeviceState({
        hasDevice: true,
        trustedNowMs: tSync + LEASE_MS + 1, // after 7 Dec 20:00 WIB
        lastSuccessSyncAtMs: tSync,
        maxSeenTimeMs: tSync,
      }),
    ).toEqual({ kind: 'LOCKED_LEASE' })

    // Clock rollback boundary: 4:59 OK vs 5:01 LOCKED_CLOCK
    expect(
      computeDeviceState({
        hasDevice: true,
        trustedNowMs: tSync - (CLOCK_BACK_TOLERANCE_MS - 1_000),
        lastSuccessSyncAtMs: tSync,
        maxSeenTimeMs: tSync,
      }),
    ).toEqual({ kind: 'OK' })

    expect(
      computeDeviceState({
        hasDevice: true,
        trustedNowMs: tSync - (CLOCK_BACK_TOLERANCE_MS + 1_000),
        lastSuccessSyncAtMs: tSync,
        maxSeenTimeMs: tSync,
      }),
    ).toEqual({ kind: 'LOCKED_CLOCK' })

    // Unsynced new paired device without updateRequired stays OK; with updateRequired => UPDATE_REQUIRED
    expect(
      computeDeviceState({
        hasDevice: true,
        trustedNowMs: tSync,
        lastSuccessSyncAtMs: null,
        maxSeenTimeMs: tSync,
      }),
    ).toEqual({ kind: 'OK' })

    expect(
      computeDeviceState({
        hasDevice: true,
        trustedNowMs: tSync,
        lastSuccessSyncAtMs: tSync,
        maxSeenTimeMs: tSync,
        flags: { updateRequired: true },
      }),
    ).toEqual({ kind: 'UPDATE_REQUIRED' })
  })
})
