import type { BillRecord } from '../db/types'

export function canMergeBillsTarget(
  targetBill: Pick<BillRecord, 'status' | 'lease_device_id' | 'handover_status' | 'parent_bill_id'>,
  deviceId: string,
): boolean {
  return (
    targetBill.status === 'OPEN' &&
    targetBill.lease_device_id === deviceId &&
    targetBill.handover_status === 'NONE' &&
    targetBill.parent_bill_id === null
  )
}

export function filterMergeCandidates(
  allLocalBills: readonly BillRecord[],
  targetBillId: string,
  deviceId: string,
): readonly BillRecord[] {
  return allLocalBills.filter(
    (b) =>
      b.id !== targetBillId &&
      b.status === 'OPEN' &&
      b.lease_device_id === deviceId &&
      b.handover_status === 'NONE' &&
      b.parent_bill_id === null,
  )
}
