import { isPermissionCode } from '~/modules/identity/shared'
import { loadStaffSessionSummary } from '../data/pin.repo'
import type { SolvaDb } from '../db/solva-db'
import { verifyStaffPin, type VerifyPinResult, type VerifyStaffPinDeps } from './pin-verify'

export type ApprovalPermission = 'discount.approve' | 'return.approve' | 'sale.void'

export type ApprovalResult =
  | { readonly approved: true; readonly approverId: string; readonly displayName: string }
  | {
      readonly approved: false
      readonly reason:
        | 'SELF_APPROVAL_FORBIDDEN'
        | 'APPROVER_NOT_FOUND'
        | 'MISSING_PERMISSION'
        | 'DISCOUNT_LIMIT_EXCEEDED'
        | 'PIN_FAILED'
      readonly verifyResult?: Exclude<VerifyPinResult, { ok: true }>
    }

/**
 * Verifies local supervisor PIN override per BR-AUT-007 & BR-DSC-003:
 * - Rejects self-approval (`approverId === requesterId`).
 * - Confirms approver has the required permission and sufficient `discountLimitPct` if `requestedPct` given.
 * - Verifies PIN through `verifyStaffPin` (counting attempts on the approver's own counter).
 * Caller records the corresponding `enqueueAudit` entry upon approval.
 */
export async function requestSupervisorApproval(
  db: SolvaDb,
  input: {
    outletId: string
    deviceId: string
    registerId: string
    requesterId: string
    approverId: string
    pin: string
    permission: ApprovalPermission
    requestedPct?: string | number
    trustedNowMs: number
    maxSeenMs: number
  },
  deps?: VerifyStaffPinDeps,
): Promise<ApprovalResult> {
  if (input.approverId === input.requesterId) {
    return { approved: false, reason: 'SELF_APPROVAL_FORBIDDEN' }
  }

  const approver = await loadStaffSessionSummary(db, input.approverId, input.outletId)
  if (!approver) {
    return { approved: false, reason: 'APPROVER_NOT_FOUND' }
  }

  const permSet = new Set(approver.permissions.filter(isPermissionCode))
  if (!permSet.has(input.permission)) {
    return { approved: false, reason: 'MISSING_PERMISSION' }
  }

  if (input.requestedPct !== undefined) {
    const reqNum =
      typeof input.requestedPct === 'number' ? input.requestedPct : Number(input.requestedPct)
    if (!Number.isFinite(reqNum) || approver.discountLimitPct < reqNum) {
      return { approved: false, reason: 'DISCOUNT_LIMIT_EXCEEDED' }
    }
  }

  const verifyResult = await verifyStaffPin(
    db,
    {
      userId: input.approverId,
      pin: input.pin,
      deviceId: input.deviceId,
      registerId: input.registerId,
      trustedNowMs: input.trustedNowMs,
      maxSeenMs: input.maxSeenMs,
    },
    deps,
  )

  if (!verifyResult.ok) {
    return { approved: false, reason: 'PIN_FAILED', verifyResult }
  }

  return { approved: true, approverId: approver.userId, displayName: approver.displayName }
}
