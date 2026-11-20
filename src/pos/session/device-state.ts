export const LEASE_MS = 7 * 24 * 60 * 60 * 1000
export const LEASE_WARNING_MS = LEASE_MS - 24 * 60 * 60 * 1000
export const CLOCK_BACK_TOLERANCE_MS = 5 * 60 * 1000

export type DeviceState =
  | { kind: 'UNPAIRED' }
  | { kind: 'OK' }
  | { kind: 'LEASE_WARNING'; hoursLeft: number }
  | { kind: 'LOCKED_LEASE' }
  | { kind: 'LOCKED_CLOCK' }
  | { kind: 'REVOKED' }
  | { kind: 'CREDENTIAL_EXPIRED' }
  | { kind: 'TENANT_SUSPENDED' }
  | { kind: 'UPDATE_REQUIRED' }

/**
 * Computes offset-corrected device time without clamping backwards; `maxSeenMs`
 * is compared separately inside `computeDeviceState` to detect clock tampering.
 */
export function trustedNowMs(input: {
  nowMs: number
  clockOffsetMs: number
  maxSeenMs: number
}): number {
  return input.nowMs + input.clockOffsetMs
}

export interface ComputeDeviceStateInput {
  hasDevice: boolean
  trustedNowMs: number
  lastSuccessSyncAtMs: number | null
  maxSeenTimeMs: number
  flags?: {
    revoked?: boolean
    credentialExpired?: boolean
    tenantSuspended?: boolean
    updateRequired?: boolean
  }
}

/**
 * Computes device authorization/sync state strictly by priority (highest -> lowest):
 * 1. !hasDevice => UNPAIRED
 * 2. revoked => REVOKED
 * 3. credentialExpired => CREDENTIAL_EXPIRED
 * 4. tenantSuspended (when notified by server / post-lease) => TENANT_SUSPENDED
 * 5. trustedNowMs < maxSeenTimeMs - 5 min => LOCKED_CLOCK
 * 6. lastSuccessSyncAtMs == null => UPDATE_REQUIRED (if flagged) else OK
 * 7. trustedNowMs - lastSuccessSyncAtMs > 7 days => LOCKED_LEASE
 * 8. trustedNowMs - lastSuccessSyncAtMs > 6 days => LEASE_WARNING
 * 9. updateRequired => UPDATE_REQUIRED
 * 10. OK
 */
export function computeDeviceState(input: ComputeDeviceStateInput): DeviceState {
  if (!input.hasDevice) {
    return { kind: 'UNPAIRED' }
  }

  const flags = input.flags ?? {}
  if (flags.revoked) {
    return { kind: 'REVOKED' }
  }
  if (flags.credentialExpired) {
    return { kind: 'CREDENTIAL_EXPIRED' }
  }
  if (flags.tenantSuspended) {
    return { kind: 'TENANT_SUSPENDED' }
  }

  if (input.trustedNowMs < input.maxSeenTimeMs - CLOCK_BACK_TOLERANCE_MS) {
    return { kind: 'LOCKED_CLOCK' }
  }

  if (input.lastSuccessSyncAtMs === null) {
    return flags.updateRequired ? { kind: 'UPDATE_REQUIRED' } : { kind: 'OK' }
  }

  const elapsedMs = input.trustedNowMs - input.lastSuccessSyncAtMs
  if (elapsedMs > LEASE_MS) {
    return { kind: 'LOCKED_LEASE' }
  }

  if (elapsedMs > LEASE_WARNING_MS) {
    const remainingMs = LEASE_MS - elapsedMs
    const hoursLeft = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)))
    return { kind: 'LEASE_WARNING', hoursLeft }
  }

  if (flags.updateRequired) {
    return { kind: 'UPDATE_REQUIRED' }
  }

  return { kind: 'OK' }
}
