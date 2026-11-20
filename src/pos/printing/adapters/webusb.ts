import type { PrinterCapabilities } from '../printer-profiles'
import { encodeCashDrawerPulse } from '../escpos/encoder'
import { findPrinterProfile } from '../printer-profiles'
import {
  PrinterAdapterError,
  type PrinterAdapter,
  type PrinterState,
  type PrinterStatusResult,
  type PrintJobPayload,
  type PrintResult,
} from './types'

export interface UsbEndpointLike {
  readonly endpointNumber: number
  readonly direction: 'in' | 'out'
  readonly type: string
}

export interface UsbInterfaceLike {
  readonly interfaceNumber: number
  readonly alternates: readonly { readonly endpoints: readonly UsbEndpointLike[] }[]
}

export interface UsbDeviceLike {
  readonly serialNumber?: string | null
  readonly productName?: string | null
  readonly opened: boolean
  readonly configuration?: { readonly interfaces: readonly UsbInterfaceLike[] } | null
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(configurationValue: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  transferOut(endpointNumber: number, data: BufferSource): Promise<{ status: string }>
}

export interface NavigatorUsbLike {
  getDevices(): Promise<readonly UsbDeviceLike[]>
  requestDevice(options: { filters: readonly Record<string, unknown>[] }): Promise<UsbDeviceLike>
  addEventListener?(type: 'connect' | 'disconnect', listener: (ev: { device?: UsbDeviceLike }) => void): void
  removeEventListener?(type: 'connect' | 'disconnect', listener: (ev: { device?: UsbDeviceLike }) => void): void
}

export class WebUsbPrinterAdapter implements PrinterAdapter {
  readonly kind = 'webusb' as const
  readonly capabilities: PrinterCapabilities

  private readonly profileId: string
  private readonly usb: NavigatorUsbLike | null
  private device: UsbDeviceLike | null = null
  private outEndpoint: number | null = null
  private _state: PrinterState = 'UNPAIRED'
  private readonly onDisconnectBound = (ev: { device?: UsbDeviceLike }) => {
    if (!ev.device || ev.device === this.device) {
      this.outEndpoint = null
      this._state = 'DISCONNECTED'
    }
  }

  constructor(opts: { profileId?: string; usb?: NavigatorUsbLike | null } = {}) {
    this.profileId = opts.profileId ?? 'escpos-58'
    this.capabilities = findPrinterProfile(this.profileId).capabilities
    this.usb =
      opts.usb !== undefined
        ? opts.usb
        : typeof navigator !== 'undefined' && 'usb' in navigator
          ? ((navigator as unknown as { usb?: NavigatorUsbLike }).usb ?? null)
          : null
    this.usb?.addEventListener?.('disconnect', this.onDisconnectBound)
  }

  state(): PrinterState {
    return this._state
  }

  async connect(opts: { userGesture: boolean }): Promise<void> {
    if (!this.usb) {
      this._state = 'ERROR'
      throw new PrinterAdapterError('UNSUPPORTED', 'WebUSB API is unavailable')
    }
    try {
      if (!this.device) {
        const existing = await this.usb.getDevices()
        if (existing.length > 0) {
          this.device = existing[0]!
        } else if (opts.userGesture) {
          this.device = await this.usb.requestDevice({ filters: [{ classCode: 7 }] })
        } else {
          this._state = 'UNPAIRED'
          throw new PrinterAdapterError('NO_PRINTER', 'No paired WebUSB printer')
        }
      }

      if (!this.device.opened) {
        await this.device.open()
      }
      if (!this.device.configuration) {
        await this.device.selectConfiguration(1)
      }
      const ifaces = this.device.configuration?.interfaces ?? []
      let claimedEndpoint: number | null = null
      for (const iface of ifaces) {
        const alt = iface.alternates[0]
        const ep = alt?.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
        if (ep) {
          await this.device.claimInterface(iface.interfaceNumber)
          claimedEndpoint = ep.endpointNumber
          break
        }
      }
      if (claimedEndpoint === null) {
        this._state = 'ERROR'
        throw new PrinterAdapterError('NO_PRINTER', 'No bulk OUT USB endpoint found')
      }
      this.outEndpoint = claimedEndpoint
      this._state = 'READY'
    } catch (err) {
      if (err instanceof PrinterAdapterError) throw err
      this._state = 'DISCONNECTED'
      throw new PrinterAdapterError(
        'DISCONNECTED',
        err instanceof Error ? err.message : 'USB connection failed',
      )
    }
  }

  async print(job: PrintJobPayload): Promise<PrintResult> {
    if (!job.bytes) {
      throw new PrinterAdapterError('ENCODE_ERROR', 'WebUSB adapter requires encoded ESC/POS bytes')
    }
    if (this._state !== 'READY' || !this.device || this.outEndpoint === null) {
      await this.connect({ userGesture: false })
    }
    if (!this.device || this.outEndpoint === null) {
      throw new PrinterAdapterError('DISCONNECTED', 'USB printer not ready')
    }

    this._state = 'BUSY'
    const firstByteAtIso = new Date().toISOString()
    try {
      const chunkSize = Math.max(8, this.capabilities.maxWriteBytes)
      for (let offset = 0; offset < job.bytes.length; offset += chunkSize) {
        const slice = job.bytes.subarray(offset, offset + chunkSize)
        const transfer = await this.device.transferOut(this.outEndpoint, new Uint8Array(slice))
        if (transfer.status !== 'ok') {
          this._state = 'DISCONNECTED'
          throw new PrinterAdapterError('DISCONNECTED', `USB transfer failed: ${transfer.status}`)
        }
        if (offset + chunkSize < job.bytes.length && this.capabilities.writePacingMs > 0) {
          await new Promise((r) => setTimeout(r, this.capabilities.writePacingMs))
        }
      }
      this._state = 'READY'
      return {
        ok: true,
        firstByteAtIso,
        doneAtIso: new Date().toISOString(),
        bytesSent: job.bytes.length,
      }
    } catch (err) {
      this._state = 'DISCONNECTED'
      if (err instanceof PrinterAdapterError) throw err
      throw new PrinterAdapterError(
        'DISCONNECTED',
        err instanceof Error ? err.message : 'USB write failed',
      )
    }
  }

  async openDrawer(): Promise<void> {
    const pulse = encodeCashDrawerPulse(findPrinterProfile(this.profileId))
    await this.print({ bytes: pulse })
  }

  async status(): Promise<PrinterStatusResult> {
    return { online: this._state === 'READY' && Boolean(this.device?.opened) }
  }

  async disconnect(): Promise<void> {
    this.usb?.removeEventListener?.('disconnect', this.onDisconnectBound)
    try {
      if (this.device?.opened) {
        await this.device.close()
      }
    } finally {
      this.outEndpoint = null
      this._state = 'DISCONNECTED'
    }
  }
}
