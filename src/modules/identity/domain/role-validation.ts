export const ROLE_NAME_MAX_LENGTH = 60
export const ROLE_DISCOUNT_MIN = 0
export const ROLE_DISCOUNT_MAX = 100

/** Parses a discount text field; returns null when empty, not a number, or outside the allowed range. */
export function parseDiscountInput(input: string): number | null {
  if (input.trim() === '') {
    return null
  }
  const value = Number(input)
  if (!Number.isFinite(value) || value < ROLE_DISCOUNT_MIN || value > ROLE_DISCOUNT_MAX) {
    return null
  }
  return value
}

export type RoleDraftIssue =
  | { field: 'name' }
  | { field: 'discount'; reason: 'invalid' }
  | { field: 'discount'; reason: 'aboveActor'; limit: number }
  | { field: 'permissions' }

export interface RoleDraftRules {
  actorDiscountLimitPct: number
  /** When true a discount above the actor's own limit is an issue. */
  enforceActorLimit: boolean
  checkDiscount: boolean
  checkPermissions: boolean
}

/**
 * Client-side checks shared by the create dialog and the detail panel (the server validates again).
 * Issues are returned in field order: name, discount, permissions.
 */
export function validateRoleDraft(
  draft: { name: string; discountInput: string; permissionCount: number },
  rules: RoleDraftRules,
): RoleDraftIssue[] {
  const issues: RoleDraftIssue[] = []
  if (draft.name.trim() === '') {
    issues.push({ field: 'name' })
  }
  if (rules.checkDiscount) {
    const discount = parseDiscountInput(draft.discountInput)
    if (discount === null) {
      issues.push({ field: 'discount', reason: 'invalid' })
    } else if (rules.enforceActorLimit && discount > rules.actorDiscountLimitPct) {
      issues.push({ field: 'discount', reason: 'aboveActor', limit: rules.actorDiscountLimitPct })
    }
  }
  if (rules.checkPermissions && draft.permissionCount === 0) {
    issues.push({ field: 'permissions' })
  }
  return issues
}
