import { describe, expect, it, vi } from 'vitest'
import { findPrinterProfile } from '../printer-profiles'
import { BrowserPrintAdapter } from './browser-print'
import { PrinterAdapterError } from './types'
import { VirtualPrinterAdapter } from './virtual'
import { WebBluetoothPrinterAdapter, type NavigatorBluetoothLike } from './webbluetooth'
import { WebUsbPrinterAdapter, type NavigatorUsbLike } from './webusb'

describe('pos/printing/adapters', () => {
  it('chunks WebUSB transfers by maxWriteBytes and handles disconnect', async () => {
    const chunks: number[] = []
    let failTransfer = false
    const fakeUsb: NavigatorUsbLike = {
      async getDevices() {
        return [
          {
            opened: false,
            configuration: {
              interfaces: [
                {
                  interfaceNumber: 0,
                  alternates: [
                    { endpoints: [{ endpointNumber: 1, direction: 'out', type: 'bulk' }] },
                  ],
                },
              ],
            },
            async open() {
              (this as { opened: boolean }).opened = true
            },
            async close() {},
            async selectConfiguration() {},
            async claimInterface() {},
            async transferOut(_ep, data) {
              if (failTransfer) return { status: 'stall' }
              chunks.push(data.byteLength)
              return { status: 'ok' }
            },
          },
        ]
      },
      async requestDevice() {
        throw new Error('not needed when paired')
      },
    }

    const usb = new WebUsbPrinterAdapter({ profileId: 'escpos-58', usb: fakeUsb })
    await usb.connect({ userGesture: false })
    expect(usb.state()).toBe('READY')

    // 140 bytes -> 64 + 64 + 12 chunks
    const res = await usb.print({ bytes: new Uint8Array(140) })
    expect(res.bytesSent).toBe(140)
    expect(chunks).toEqual([64, 64, 12])

    failTransfer = true
    await expect(usb.print({ bytes: new Uint8Array(10) })).rejects.toMatchObject({
      code: 'DISCONNECTED',
    } satisfies Partial<PrinterAdapterError>)
    expect(usb.state()).toBe('DISCONNECTED')
  })

  it('chunks BLE GATT writes <= 20B and stays UNPAIRED when getDevices missing', async () => {
    const writes: number[] = []
    const noPersistBle: NavigatorBluetoothLike = {
      async requestDevice() {
        return {
          id: 'ble-1',
          gatt: {
            connected: false,
            async connect() {
              (this as { connected: boolean }).connected = true
              return this
            },
            disconnect() {},
            async getPrimaryService() {
              return {
                async getCharacteristic() {
                  return {
                    async writeValueWithoutResponse(v) {
                      writes.push(v.byteLength)
                    },
                  }
                },
              }
            },
          },
        }
      },
    }

    const profile = findPrinterProfile('ble-generic')
    const ble = new WebBluetoothPrinterAdapter({
      profileId: profile.id,
      bluetooth: noPersistBle,
    })

    // Without userGesture and without getDevices() -> NO_PRINTER (UNPAIRED)
    await expect(ble.connect({ userGesture: false })).rejects.toMatchObject({
      code: 'NO_PRINTER',
    } satisfies Partial<PrinterAdapterError>)
    expect(ble.state()).toBe('UNPAIRED')

    // With userGesture -> pairs & chunks 45 bytes into [20, 20, 5]
    await ble.connect({ userGesture: true })
    expect(ble.state()).toBe('READY')
    await ble.print({ bytes: new Uint8Array(45) })
    expect(writes).toEqual([20, 20, 5])
  })

  it('BrowserPrintAdapter disables drawer open and invokes html print function', async () => {
    const htmlSpy = vi.fn().mockResolvedValue(undefined)
    const bp = new BrowserPrintAdapter({ paperWidthMm: 80, printHtml: htmlSpy })
    expect(bp.capabilities.canOpenDrawer).toBe(false)
    await expect(bp.openDrawer()).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    } satisfies Partial<PrinterAdapterError>)

    await bp.print({ doc: [{ t: 'text', text: 'HELLO' }] })
    expect(htmlSpy).toHaveBeenCalledTimes(1)
  })

  it('VirtualPrinterAdapter simulates failures and recovers', async () => {
    const v = new VirtualPrinterAdapter({ profileId: 'escpos-58' })
    v.setFailNext('TIMEOUT')
    await expect(v.print({ bytes: new Uint8Array([1, 2]) })).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
    const res = await v.print({ bytes: new Uint8Array([1, 2, 3]) })
    expect(res.bytesSent).toBe(3)
    expect(v.printedBatches).toHaveLength(1)
  })
})
