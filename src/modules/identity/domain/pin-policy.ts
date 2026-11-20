export type PinRejectReason = 'LENGTH' | 'NOT_DIGITS' | 'WEAK'

export type PinValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PinRejectReason }

/**
 * Validates terminal PIN policy (ARCHITECTURE §6.2, §6.4):
 * - Strictly 4..6 ASCII decimal digits
 * - Rejects weak trivial patterns (all identical digits e.g. `0000`/`111111`,
 *   full ascending runs e.g. `1234`/`23456`, full descending runs e.g. `4321`/`987654`).
 */
export function validatePin(pin: string): PinValidationResult {
  if (pin.length < 4 || pin.length > 6) {
    return { ok: false, reason: 'LENGTH' }
  }
  if (!/^\d{4,6}$/.test(pin)) {
    return { ok: false, reason: 'NOT_DIGITS' }
  }

  let allSame = true
  let allAsc = true
  let allDesc = true

  for (let i = 1; i < pin.length; i += 1) {
    const prev = pin.charCodeAt(i - 1)
    const curr = pin.charCodeAt(i)
    if (curr !== prev) allSame = false
    if (curr !== prev + 1) allAsc = false
    if (curr !== prev - 1) allDesc = false
  }

  if (allSame || allAsc || allDesc) {
    return { ok: false, reason: 'WEAK' }
  }

  return { ok: true }
}
