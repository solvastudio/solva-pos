import { isPermissionCode, type PermissionCode } from '~/modules/identity/shared'
import { loadStaffSessionSummary } from '../data/pin.repo'
import type { SolvaDb } from '../db/solva-db'

export interface StaffSessionContext {
  readonly staffId: string
  readonly displayName: string
  readonly roleCodes: readonly string[]
  readonly permissions: ReadonlySet<PermissionCode>
  readonly discountLimitPct: number
  readonly outletIds: readonly string[] | null
}

export interface PosRuntimeSessionState {
  readonly staff: StaffSessionContext | null
  readonly paymentInProgress: boolean
  readonly supervisorDialogOpen: boolean
}

let currentState: PosRuntimeSessionState = {
  staff: null,
  paymentInProgress: false,
  supervisorDialogOpen: false,
}

const listeners = new Set<(next: PosRuntimeSessionState) => void>()

function emitChange(next: PosRuntimeSessionState) {
  currentState = next
  for (const listener of listeners) {
    listener(currentState)
  }
}

export function getSessionState(): PosRuntimeSessionState {
  return currentState
}

export function subscribeSessionState(
  listener: (next: PosRuntimeSessionState) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Starts an in-memory POS staff session from local Dexie master tables (`app_user`,
 * `user_outlet`, `role`, `role_permission`). Never persisted across page reloads (BR-AUT-003).
 */
export async function startSession(
  db: SolvaDb,
  staffId: string,
  outletId: string,
): Promise<StaffSessionContext> {
  const summary = await loadStaffSessionSummary(db, staffId, outletId)
  if (!summary) {
    throw new Error(`Staff ${staffId} has no active assignment for outlet ${outletId}`)
  }

  const permissions = new Set<PermissionCode>()
  for (const p of summary.permissions) {
    if (isPermissionCode(p)) {
      permissions.add(p)
    }
  }

  const staff: StaffSessionContext = {
    staffId: summary.userId,
    displayName: summary.displayName,
    roleCodes: [...summary.roleCodes],
    permissions,
    discountLimitPct: summary.discountLimitPct,
    outletIds: summary.outletIds,
  }

  emitChange({ ...currentState, staff })
  return staff
}

export function clearSession(): void {
  emitChange({
    staff: null,
    paymentInProgress: false,
    supervisorDialogOpen: false,
  })
}

export function hasPermission(code: PermissionCode, ctx: StaffSessionContext | null = currentState.staff): boolean {
  return ctx !== null && ctx.permissions.has(code)
}

export function setPaymentInProgress(active: boolean): void {
  if (currentState.paymentInProgress === active) return
  emitChange({ ...currentState, paymentInProgress: active })
}

export function setSupervisorDialogOpen(open: boolean): void {
  if (currentState.supervisorDialogOpen === open) return
  emitChange({ ...currentState, supervisorDialogOpen: open })
}
