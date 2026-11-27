/** Key that identifies "all outlets" when comparing member outlet assignments. */
export const ALL_OUTLETS_KEY = '__ALL__'

/** Comparison key of an assignment outlet; `null` means every outlet of the tenant. */
export function assignmentOutletKey(outletId: string | null): string {
  return outletId ?? ALL_OUTLETS_KEY
}
