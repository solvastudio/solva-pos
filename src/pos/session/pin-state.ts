export type PinLockTier = 0 | 1 | 2 | 3

export interface PinState {
  readonly user_id: string
  readonly device_id: string
  readonly failed_count: number
  readonly lock_tier: PinLockTier
  readonly locked_until: string | null
  readonly last_failed_at: string | null
  readonly pin_epoch_seen: number
}

export interface PinLockEvaluation {
  readonly locked: boolean
  readonly minutesLeft: number
  readonly needsReset: boolean
}

export const PIN_MAX_ATTEMPTS = 15
export const PIN_TIER1_THRESHOLD = 5
export const PIN_TIER2_THRESHOLD = 10
export const PIN_TIER1_DURATION_MS = 5 * 60 * 1000
export const PIN_TIER2_DURATION_MS = 15 * 60 * 1000

export function createInitialPinState(
  userId: string,
  deviceId: string,
  pinEpoch = 1,
): PinState {
  return {
    user_id: userId,
    device_id: deviceId,
    failed_count: 0,
    lock_tier: 0,
    locked_until: null,
    last_failed_at: null,
    pin_epoch_seen: Math.max(1, pinEpoch),
  }
}

function effectiveClockMs(trustedNowMs: number, maxSeenMs: number): number {
  return Math.max(trustedNowMs, maxSeenMs)
}

/**
 * Resets local failure counters and lock tier when server `pin_epoch` increases (FR-AUT-007).
 */
export function applyEpoch(
  state: PinState,
  credentialEpoch: number,
): { readonly state: PinState; readonly changed: boolean } {
  if (credentialEpoch > state.pin_epoch_seen) {
    return {
      changed: true,
      state: {
        user_id: state.user_id,
        device_id: state.device_id,
        failed_count: 0,
        lock_tier: 0,
        locked_until: null,
        last_failed_at: null,
        pin_epoch_seen: credentialEpoch,
      },
    }
  }
  return { state, changed: false }
}

/**
 * Evaluates whether the staff member is currently locked out using `locked_until - max(trustedNow, maxSeenTime)`
 * so rewinding the tablet clock never shortens cooldowns (BR-AUT-005, BR-AUT-013).
 */
export function isLocked(
  state: PinState,
  trustedNowMs: number,
  maxSeenMs: number,
): PinLockEvaluation {
  if (state.lock_tier === 3 || state.failed_count >= PIN_MAX_ATTEMPTS) {
    return { locked: true, minutesLeft: 0, needsReset: true }
  }

  if ((state.lock_tier === 1 || state.lock_tier === 2) && state.locked_until !== null) {
    const untilMs = Date.parse(state.locked_until)
    if (Number.isFinite(untilMs)) {
      const remainingMs = untilMs - effectiveClockMs(trustedNowMs, maxSeenMs)
      if (remainingMs > 0) {
        return {
          locked: true,
          minutesLeft: Math.max(1, Math.ceil(remainingMs / 60_000)),
          needsReset: false,
        }
      }
    }
  }

  return { locked: false, minutesLeft: 0, needsReset: false }
}

/**
 * Pessimistically increments `failed_count` BEFORE PIN hashing runs so closing/reloading
 * the tab mid-verification cannot bypass attempt counting (ARCHITECTURE §6.4).
 */
export function recordAttempt(
  state: PinState,
  trustedNowMs: number,
  maxSeenMs: number,
): PinState {
  const clockMs = effectiveClockMs(trustedNowMs, maxSeenMs)
  return {
    ...state,
    failed_count: Math.min(PIN_MAX_ATTEMPTS, state.failed_count + 1),
    last_failed_at: new Date(clockMs).toISOString(),
  }
}

export function onSuccess(state: PinState): PinState {
  return {
    ...state,
    failed_count: 0,
    lock_tier: 0,
    locked_until: null,
  }
}

/**
 * Computes progressive lockout tier after an attempt fails (5 -> 5m tier 1, 10 -> 15m tier 2,
 * 15 -> permanent tier 3 requiring supervisor reset). Count never decays with time.
 */
export function onFailure(
  state: PinState,
  trustedNowMs: number,
  maxSeenMs: number,
): PinState {
  const clockMs = effectiveClockMs(trustedNowMs, maxSeenMs)

  if (state.failed_count >= PIN_MAX_ATTEMPTS) {
    return {
      ...state,
      failed_count: PIN_MAX_ATTEMPTS,
      lock_tier: 3,
      locked_until: null,
    }
  }

  if (state.failed_count === PIN_TIER2_THRESHOLD) {
    return {
      ...state,
      lock_tier: 2,
      locked_until: new Date(clockMs + PIN_TIER2_DURATION_MS).toISOString(),
    }
  }

  if (state.failed_count === PIN_TIER1_THRESHOLD) {
    return {
      ...state,
      lock_tier: 1,
      locked_until: new Date(clockMs + PIN_TIER1_DURATION_MS).toISOString(),
    }
  }

  return {
    ...state,
    lock_tier: 0,
    locked_until: null,
  }
}

/**
 * Returns remaining attempts before the next lock threshold (5, 10, or 15).
 */
export function remainingAttempts(state: PinState): number {
  if (state.failed_count >= PIN_MAX_ATTEMPTS) return 0
  if (state.failed_count < PIN_TIER1_THRESHOLD) {
    return PIN_TIER1_THRESHOLD - state.failed_count
  }
  if (state.failed_count === PIN_TIER1_THRESHOLD) return 0
  if (state.failed_count < PIN_TIER2_THRESHOLD) {
    return PIN_TIER2_THRESHOLD - state.failed_count
  }
  if (state.failed_count === PIN_TIER2_THRESHOLD) return 0
  return PIN_MAX_ATTEMPTS - state.failed_count
}
