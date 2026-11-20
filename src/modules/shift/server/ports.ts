import '@tanstack/react-start/server-only'
import type { TenantTx } from '~/server/db'

export interface ShiftRecapSalesTotals {
  readonly cashSales: number
  readonly cashRefund: number
}

export interface ShiftRecapSalesPort {
  getShiftCashTotals(tx: TenantTx, shiftId: string): Promise<ShiftRecapSalesTotals>
}

const defaultPort: ShiftRecapSalesPort = {
  async getShiftCashTotals() {
    return { cashSales: 0, cashRefund: 0 }
  },
}

let activePort: ShiftRecapSalesPort = defaultPort

export function registerShiftRecapSalesPort(port: ShiftRecapSalesPort): void {
  activePort = port
}

export function getShiftRecapSalesPort(): ShiftRecapSalesPort {
  return activePort
}

export function __clearShiftRecapSalesPortForTests(): void {
  activePort = defaultPort
}
