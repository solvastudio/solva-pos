import { cmpQty, parseQty, subQty, type Qty } from '~/lib/kernel'
import { isWithinReturnWindow } from '~/lib/sales-calc'

export type ReturnEligibilityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'INVOICE_VOIDED' | 'OUTSIDE_RETURN_WINDOW' }

export function checkReturnEligibility(params: {
  invoiceStatus: string
  invoiceBusinessDate: string
  todayBusinessDate: string
}): ReturnEligibilityResult {
  if (params.invoiceStatus === 'VOID') {
    return { ok: false, reason: 'INVOICE_VOIDED' }
  }
  if (!isWithinReturnWindow(params.invoiceBusinessDate, params.todayBusinessDate)) {
    return { ok: false, reason: 'OUTSIDE_RETURN_WINDOW' }
  }
  return { ok: true }
}

export function computeRemainingReturnQty(soldQty: string, returnedSoFarQty: string): Qty {
  const sold = parseQty(soldQty)
  const returned = parseQty(returnedSoFarQty)
  if (cmpQty(returned, sold) >= 0) {
    return parseQty('0')
  }
  return subQty(sold, returned)
}
