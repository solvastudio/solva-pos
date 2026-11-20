import { logClientError } from '~/lib/client-errors/report-schema'
import {
  getStaffPinRecord,
  getStaffPinStateRecord,
  savePinStateWithOptionalReport,
} from '../data/pin.repo'
import type { SolvaDb } from '../db/solva-db'
import type { StaffPinRecord } from '../db/types'
import {
  base64UrlToBytes,
  computePinHash,
  constantTimeEqual,
  PinCryptoError,
} from './pin-kdf'
import {
  applyEpoch,
  createInitialPinState,
  isLocked,
  onFailure,
  onSuccess,
  recordAttempt,
  remainingAttempts,
  type PinState,
} from './pin-state'

export type VerifyPinResult =
  | { readonly ok: true; readonly staffId: string }
  | {
      readonly ok: false
      readonly reason: 'NO_CREDENTIAL' | 'LOCKED' | 'WRONG_PIN' | 'CRYPTO_FAILED'
      readonly remaining: number
      readonly locked?: { readonly minutes: number } | { readonly needsReset: true }
    }

export interface VerifyStaffPinDeps {
  computeHash?: (
    pin: string,
    row: Pick<StaffPinRecord, 'device_salt' | 'kdf_algo' | 'kdf_params' | 'kdf_salt'>,
  ) => Promise<Uint8Array>
  afterAttemptWriteHook?: () => Promise<void> | void
  onCryptoError?: (code: 'APP_ERROR', message: string) => Promise<void> | void
}

function effectiveIso(trustedNowMs: number, maxSeenMs: number): string {
  return new Date(Math.max(trustedNowMs, maxSeenMs)).toISOString()
}

function toReportPayload(state: PinState) {
  return {
    user_id: state.user_id,
    failed_count: state.failed_count,
    lock_tier: state.lock_tier,
    locked_until: state.locked_until,
    last_failed_at: state.last_failed_at,
    pin_epoch_seen: state.pin_epoch_seen,
  }
}

/**
 * Verifies a staff member's PIN offline against `staff_pin` following ARCHITECTURE §6.4:
 * 1) Apply server `pin_epoch` bump (clears local counter & queues `ReportPinState`).
 * 2) Reject if currently locked (`locked_until - max(trustedNow, maxSeenTime)` or `tier 3`).
 * 3) Pessimistically persist `failed_count + 1` BEFORE KDF runs so reload mid-check cannot bypass.
 * 4) Compute `Argon2id` + `HMAC-SHA256` and compare constant-time.
 * 5) Clear counter on match, or set progressive lockout tier and queue `ReportPinState` on tier change.
 * Plain PIN is never stored or logged.
 */
export async function verifyStaffPin(
  db: SolvaDb,
  input: {
    userId: string
    pin: string
    deviceId: string
    registerId: string
    trustedNowMs: number
    maxSeenMs: number
  },
  deps: VerifyStaffPinDeps = {},
): Promise<VerifyPinResult> {
  const credRow = await getStaffPinRecord(db, input.userId)
  if (!credRow) {
    return { ok: false, reason: 'NO_CREDENTIAL', remaining: 0 }
  }

  const existingState = await getStaffPinStateRecord(db, input.userId, input.deviceId)
  let state: PinState = existingState
    ? {
        user_id: existingState.user_id,
        device_id: existingState.device_id,
        failed_count: existingState.failed_count,
        lock_tier: existingState.lock_tier,
        locked_until: existingState.locked_until,
        last_failed_at: existingState.last_failed_at,
        pin_epoch_seen: existingState.pin_epoch_seen,
      }
    : createInitialPinState(input.userId, input.deviceId, credRow.pin_epoch)

  const createdAtDevice = effectiveIso(input.trustedNowMs, input.maxSeenMs)

  // Step 1: Epoch bump from manager reset clears local lockout counters
  const epochApplied = applyEpoch(state, credRow.pin_epoch)
  if (epochApplied.changed) {
    state = epochApplied.state
    await savePinStateWithOptionalReport(db, {
      state,
      registerId: input.registerId,
      createdAtDevice,
      reportPayload: toReportPayload(state),
    })
  }

  // Step 2: Check active lockout without consuming an attempt
  const lockEval = isLocked(state, input.trustedNowMs, input.maxSeenMs)
  if (lockEval.locked) {
    return {
      ok: false,
      reason: 'LOCKED',
      remaining: 0,
      locked: lockEval.needsReset ? { needsReset: true } : { minutes: lockEval.minutesLeft },
    }
  }

  // Step 3: Pessimistic write BEFORE heavy KDF/HMAC work
  const preVerifyTier = state.lock_tier
  const attempted = recordAttempt(state, input.trustedNowMs, input.maxSeenMs)
  await savePinStateWithOptionalReport(db, {
    state: attempted,
    registerId: input.registerId,
    createdAtDevice,
    reportPayload: null,
  })
  await deps.afterAttemptWriteHook?.()

  // Step 4: Slow KDF + HMAC verification
  let computed: Uint8Array
  try {
    const computeFn = deps.computeHash ?? computePinHash
    computed = await computeFn(input.pin, credRow)
  } catch (err) {
    const msg = err instanceof PinCryptoError ? err.message : 'Unable to verify PIN'
    logClientError({
      code: 'APP_ERROR',
      level: 'error',
      ctx: { stage: 'pin_verify', userId: input.userId },
      stack: msg,
      nowMs: input.trustedNowMs,
    })
    await deps.onCryptoError?.('APP_ERROR', msg)
    return {
      ok: false,
      reason: 'CRYPTO_FAILED',
      remaining: remainingAttempts(attempted),
    }
  }

  // Step 5: Constant-time comparison
  const expected = base64UrlToBytes(credRow.pin_hash)
  if (constantTimeEqual(computed, expected)) {
    const cleared = onSuccess(attempted)
    await savePinStateWithOptionalReport(db, {
      state: cleared,
      registerId: input.registerId,
      createdAtDevice,
      reportPayload: preVerifyTier !== 0 ? toReportPayload(cleared) : null,
    })
    return { ok: true, staffId: input.userId }
  }

  // Step 6: Mismatch -> determine lockout tier and queue ReportPinState if lock_tier changed
  const failed = onFailure(attempted, input.trustedNowMs, input.maxSeenMs)
  const tierChanged = failed.lock_tier !== preVerifyTier
  await savePinStateWithOptionalReport(db, {
    state: failed,
    registerId: input.registerId,
    createdAtDevice,
    reportPayload: tierChanged ? toReportPayload(failed) : null,
  })

  if (failed.lock_tier === 3) {
    return {
      ok: false,
      reason: 'LOCKED',
      remaining: 0,
      locked: { needsReset: true },
    }
  }

  if (failed.lock_tier === 1 || failed.lock_tier === 2) {
    const postEval = isLocked(failed, input.trustedNowMs, input.maxSeenMs)
    return {
      ok: false,
      reason: 'LOCKED',
      remaining: 0,
      locked: { minutes: postEval.minutesLeft || (failed.lock_tier === 2 ? 15 : 5) },
    }
  }

  return {
    ok: false,
    reason: 'WRONG_PIN',
    remaining: remainingAttempts(failed),
  }
}
