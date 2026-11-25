import '@tanstack/react-start/server-only'
import type { TenantTx } from '~/server/db'

/**
 * Port allowing `sales` to lock/validate and close an F&B `bill` during `FinalizeSale`
 * without importing `src/modules/fnb` directly (BR-ARC-004).
 */
export interface BillPaymentRecord {
  readonly id: string
  readonly outletId: string
  readonly billRef: string
  readonly status: string
  readonly leaseDeviceId: string
  readonly leaseRegisterId: string
  readonly handoverStatus: string
  readonly splitMode: string | null
  readonly parentBillId?: string | null
  readonly shareIndex?: number | null
  readonly shareCount?: number | null
  readonly siblingBillIds?: readonly string[]
}

export interface BillPort {
  lockBillForPayment(tx: TenantTx, tenantId: string, billId: string): Promise<BillPaymentRecord | null>
  markBillPaid(tx: TenantTx, tenantId: string, billId: string, nowIso: string): Promise<void>
}

const defaultBillPort: BillPort = {
  async lockBillForPayment() {
    return null
  },
  async markBillPaid() {
    return undefined
  },
}

let activeBillPort: BillPort = defaultBillPort

export function registerBillPort(port: BillPort): void {
  activeBillPort = port
}

export function getBillPort(): BillPort {
  return activeBillPort
}

export function __clearBillPortForTests(): void {
  activeBillPort = defaultBillPort
}
