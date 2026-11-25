import { nextSeq } from '../data/counter.repo'

type CounterTx = Parameters<typeof nextSeq>[0]

export function billRefCounterKey(tableId: string, deviceId: string): string {
  return `bill_ref|${tableId}|${deviceId}`
}

export function formatBillRef(tableCode: string, seq: number): string {
  return `${tableCode}-${String(seq).padStart(4, '0')}`
}

/**
 * Generates an operational bill reference (`M05-0003`; 5+ digits past 9999) from an atomic
 * `local_counter` inside the same `rw` transaction that creates `BILL_OPENED` (`BR-FNB-002`).
 */
export async function nextBillRef(
  tx: CounterTx,
  input: {
    tableId: string
    tableCode: string
    deviceId: string
    registerId?: string | null
    updatedAt?: string
  },
): Promise<string> {
  const seq = await nextSeq(tx, billRefCounterKey(input.tableId, input.deviceId), {
    registerId: input.registerId ?? null,
    docType: 'BILL_REF',
    updatedAt: input.updatedAt,
  })
  return formatBillRef(input.tableCode, seq)
}
