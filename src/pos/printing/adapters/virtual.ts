import type { PrinterCapabilities } from '../printer-profiles'
import { findPrinterProfile } from '../printer-profiles'
import { encodeEscPos, encodeCashDrawerPulse } from '../escpos/encoder'
import {
  PrinterAdapterError,
  type PrinterAdapter,
  type PrinterState,
  type PrinterStatusResult,
  type PrintJobPayload,
  type PrintResult,
} from './types'

export interface VirtualAdapterOptions {
  readonly profileId?: string
  readonly latencyMs?: number
  readonly initialState?: PrinterState
  readonly nowIso?: () => string
}

export class VirtualPrinterAdapter implements PrinterAdapter {
  readonly kind = 'virtual' as const
  readonly capabilities: PrinterCapabilities
  readonly printedBatches: Uint8Array[] = []
  drawerPulseCount = 0

  private _state: PrinterState
  private readonly profileId: string
  private readonly latencyMs: number
  private readonly nowIso: () => string
  private failNextMode: 'DISCONNECTED' | 'TIMEOUT' | 'ENCODE_ERROR' | null = null

  constructor(opts: VirtualAdapterOptions = {}) {
    this.profileId = opts.profileId ?? 'escpos-58'
    this.capabilities = findPrinterProfile(this.profileId).capabilities
    this._state = opts.initialState ?? 'READY'
    this.latencyMs = opts.latencyMs ?? 0
    this.nowIso = opts.nowIso ?? (() => new Date().toISOString())
  }

  setState(next: PrinterState): void {
    this._state = next
  }

  setFailNext(mode: 'DISCONNECTED' | 'TIMEOUT' | 'ENCODE_ERROR' | null): void {
    this.failNextMode = mode
  }

  state(): PrinterState {
    return this._state
  }

  async connect(_opts: { userGesture: boolean }): Promise<void> {
    if (this._state === 'ERROR') {
      throw new PrinterAdapterError('DISCONNECTED', 'Virtual printer in ERROR state')
    }
    this._state = 'READY'
  }

  async print(job: PrintJobPayload): Promise<PrintResult> {
    if (this.failNextMode) {
      const err = this.failNextMode
      this.failNextMode = null
      throw new PrinterAdapterError(err, `Simulated failure: ${err}`)
    }
    if (this._state !== 'READY') {
      throw new PrinterAdapterError('DISCONNECTED', `Virtual printer state is ${this._state}`)
    }
    const bytes =
      job.bytes ??
      (job.doc ? encodeEscPos(job.doc, findPrinterProfile(this.profileId)) : null)
    if (!bytes) {
      throw new PrinterAdapterError('ENCODE_ERROR', 'Missing print bytes or doc')
    }

    const prevState = this._state
    this._state = 'BUSY'
    const firstByteAtIso = this.nowIso()
    try {
      if (this.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.latencyMs))
      }
      this.printedBatches.push(bytes)
      const doneAtIso = this.nowIso()
      return {
        ok: true,
        firstByteAtIso,
        doneAtIso,
        bytesSent: bytes.length,
      }
    } finally {
      this._state = prevState
    }
  }

  async openDrawer(): Promise<void> {
    if (this._state !== 'READY') {
      throw new PrinterAdapterError('DISCONNECTED', `Virtual printer state is ${this._state}`)
    }
    const pulse = encodeCashDrawerPulse(findPrinterProfile(this.profileId))
    this.printedBatches.push(pulse)
    this.drawerPulseCount += 1
  }

  async status(): Promise<PrinterStatusResult> {
    return { online: this._state === 'READY' }
  }

  async disconnect(): Promise<void> {
    this._state = 'DISCONNECTED'
  }
}
