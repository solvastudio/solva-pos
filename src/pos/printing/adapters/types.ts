import type { PrinterCapabilities } from '../printer-profiles'
import type { ReceiptDoc } from '../receipt-doc'

export type AdapterKind = 'webusb' | 'webbluetooth' | 'browser-print' | 'virtual'

export type PrinterState = 'UNPAIRED' | 'DISCONNECTED' | 'READY' | 'BUSY' | 'ERROR'

export type PrintErrorCode =
  | 'NO_PRINTER'
  | 'DISCONNECTED'
  | 'TIMEOUT'
  | 'ENCODE_ERROR'
  | 'UNSUPPORTED'

export class PrinterAdapterError extends Error {
  readonly code: PrintErrorCode

  constructor(code: PrintErrorCode, message: string) {
    super(message)
    this.name = 'PrinterAdapterError'
    this.code = code
  }
}

export interface PrintJobPayload {
  readonly bytes?: Uint8Array
  readonly doc?: ReceiptDoc
  readonly paperWidthMm?: 58 | 80
}

export interface PrintResult {
  readonly ok: true
  readonly firstByteAtIso: string
  readonly doneAtIso: string
  readonly bytesSent: number
}

export interface PrinterStatusResult {
  readonly online: boolean
  readonly paperOut?: boolean
  readonly coverOpen?: boolean
}

export interface PrinterAdapter {
  readonly kind: AdapterKind
  readonly capabilities: PrinterCapabilities
  state(): PrinterState
  connect(opts: { userGesture: boolean }): Promise<void>
  print(job: PrintJobPayload): Promise<PrintResult>
  openDrawer(): Promise<void>
  status(): Promise<PrinterStatusResult>
  disconnect(): Promise<void>
}
