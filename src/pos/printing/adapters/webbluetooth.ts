import type { PrinterCapabilities } from '../printer-profiles'
import { findPrinterProfile } from '../printer-profiles'
import { encodeCashDrawerPulse } from '../escpos/encoder'
import {
  PrinterAdapterError,
  type PrinterAdapter,
  type PrinterState,
  type PrinterStatusResult,
  type PrintJobPayload,
  type PrintResult,
} from './types'

export interface BleCharacteristicLike {
  readonly properties?: { readonly writeWithoutResponse?: boolean; readonly write?: boolean }
  writeValueWithoutResponse?(value: BufferSource): Promise<void>
  writeValue?(value: BufferSource): Promise<void>
}

export interface BleServiceLike {
  getCharacteristic(uuid: string): Promise<BleCharacteristicLike>
}

export interface BleServerLike {
  readonly connected: boolean
  connect(): Promise<BleServerLike>
  disconnect(): void
  getPrimaryService(uuid: string): Promise<BleServiceLike>
}

export interface BleDeviceLike {
  readonly id?: string
  readonly name?: string | null
  readonly gatt?: BleServerLike | null
  addEventListener?(type: 'gattserverdisconnected', listener: () => void): void
  removeEventListener?(type: 'gattserverdisconnected', listener: () => void): void
}

export interface NavigatorBluetoothLike {
  requestDevice(opts: {
    filters?: readonly { services?: readonly string[] }[]
    optionalServices?: readonly string[]
  }): Promise<BleDeviceLike>
  getDevices?(): Promise<readonly BleDeviceLike[]>
}

export class WebBluetoothPrinterAdapter implements PrinterAdapter {
  readonly kind = 'webbluetooth' as const
  readonly capabilities: PrinterCapabilities

  private readonly profileId: string
  private readonly serviceUuid: string
  private readonly characteristicUuid: string
  private readonly ble: NavigatorBluetoothLike | null
  private device: BleDeviceLike | null = null
  private char: BleCharacteristicLike | null = null
  private _state: PrinterState = 'UNPAIRED'

  private readonly onGattDisconnected = () => {
    this.char = null
    this._state = 'DISCONNECTED'
  }

  constructor(opts: {
    profileId?: string
    serviceUuid?: string
    characteristicUuid?: string
    bluetooth?: NavigatorBluetoothLike | null
  } = {}) {
    this.profileId = opts.profileId ?? 'ble-generic'
    const profile = findPrinterProfile(this.profileId)
    this.capabilities = profile.capabilities
    this.serviceUuid = opts.serviceUuid ?? profile.bleServiceUuid ?? ''
    this.characteristicUuid = opts.characteristicUuid ?? profile.bleCharacteristicUuid ?? ''
    this.ble =
      opts.bluetooth !== undefined
        ? opts.bluetooth
        : typeof navigator !== 'undefined' && 'bluetooth' in navigator
          ? ((navigator as unknown as { bluetooth?: NavigatorBluetoothLike }).bluetooth ?? null)
          : null
  }

  state(): PrinterState {
    return this._state
  }

  async connect(opts: { userGesture: boolean }): Promise<void> {
    if (!this.ble) {
      this._state = 'ERROR'
      throw new PrinterAdapterError('UNSUPPORTED', 'Web Bluetooth API is unavailable')
    }
    if (!this.serviceUuid || !this.characteristicUuid) {
      this._state = 'ERROR'
      throw new PrinterAdapterError('NO_PRINTER', 'BLE GATT service/characteristic UUID required')
    }

    try {
      if (!this.device) {
        const persisted = this.ble.getDevices ? await this.ble.getDevices() : []
        if (persisted.length > 0) {
          this.device = persisted[0]!
        } else if (opts.userGesture) {
          this.device = await this.ble.requestDevice({
            filters: [{ services: [this.serviceUuid] }],
            optionalServices: [this.serviceUuid],
          })
        } else {
          this._state = 'UNPAIRED'
          throw new PrinterAdapterError('NO_PRINTER', 'BLE printer requires pairing gesture')
        }
        this.device.addEventListener?.('gattserverdisconnected', this.onGattDisconnected)
      }

      if (!this.device.gatt) {
        this._state = 'ERROR'
        throw new PrinterAdapterError('DISCONNECTED', 'BLE GATT server missing')
      }
      const server = this.device.gatt.connected
        ? this.device.gatt
        : await this.device.gatt.connect()
      const service = await server.getPrimaryService(this.serviceUuid)
      this.char = await service.getCharacteristic(this.characteristicUuid)
      this._state = 'READY'
    } catch (err) {
      if (err instanceof PrinterAdapterError) throw err
      this._state = 'DISCONNECTED'
      throw new PrinterAdapterError(
        'DISCONNECTED',
        err instanceof Error ? err.message : 'BLE connection failed',
      )
    }
  }

  async print(job: PrintJobPayload): Promise<PrintResult> {
    if (!job.bytes) {
      throw new PrinterAdapterError('ENCODE_ERROR', 'BLE adapter requires encoded ESC/POS bytes')
    }
    if (this._state !== 'READY' || !this.char) {
      await this.connect({ userGesture: false })
    }
    if (!this.char) {
      throw new PrinterAdapterError('DISCONNECTED', 'BLE characteristic not ready')
    }

    this._state = 'BUSY'
    const firstByteAtIso = new Date().toISOString()
    try {
      const chunkSize = Math.max(20, this.capabilities.maxWriteBytes)
      for (let offset = 0; offset < job.bytes.length; offset += chunkSize) {
        const chunk = new Uint8Array(job.bytes.subarray(offset, offset + chunkSize))
        if (this.char.writeValueWithoutResponse) {
          await this.char.writeValueWithoutResponse(chunk)
        } else if (this.char.writeValue) {
          await this.char.writeValue(chunk)
        } else {
          throw new PrinterAdapterError('ENCODE_ERROR', 'BLE characteristic is not writable')
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
        err instanceof Error ? err.message : 'BLE write failed',
      )
    }
  }

  async openDrawer(): Promise<void> {
    const profile = findPrinterProfile(this.profileId)
    await this.print({ bytes: encodeCashDrawerPulse(profile) })
  }

  async status(): Promise<PrinterStatusResult> {
    return { online: this._state === 'READY' && Boolean(this.device?.gatt?.connected) }
  }

  async disconnect(): Promise<void> {
    this.device?.removeEventListener?.('gattserverdisconnected', this.onGattDisconnected)
    this.device?.gatt?.disconnect()
    this.char = null
    this._state = 'DISCONNECTED'
  }
}
