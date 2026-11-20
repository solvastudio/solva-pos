import type { StaffPinRecord } from '../db/types'
import { computePinHashDirect } from './pin-kdf'

interface PinWorkerMessage {
  id: number
  pin: string
  staffPinRow: Pick<StaffPinRecord, 'device_salt' | 'kdf_algo' | 'kdf_params' | 'kdf_salt'>
}

const workerScope = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<PinWorkerMessage>) => void) | null
  postMessage(msg: unknown): void
}

workerScope.onmessage = async (ev: MessageEvent<PinWorkerMessage>) => {
  const { id, pin, staffPinRow } = ev.data
  try {
    const hash = await computePinHashDirect(pin, staffPinRow)
    workerScope.postMessage({ id, ok: true, hash })
  } catch (err) {
    workerScope.postMessage({
      id,
      ok: false,
      message: err instanceof Error ? err.message : 'Unable to compute PIN hash',
    })
  }
}
