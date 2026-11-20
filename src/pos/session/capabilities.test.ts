import { describe, expect, it } from 'vitest'
import { detectCapabilities } from './capabilities'

describe('pos/session/capabilities', () => {
  it('detects browser APIs strictly by feature presence without UA sniffing', () => {
    const empty = detectCapabilities({ navigatorObj: {}, globalObj: {} })
    expect(empty).toEqual({
      webUsb: false,
      webBluetooth: false,
      webBluetoothPersistent: false,
      barcodeDetector: false,
      hoverPointer: false,
      persistentStorage: false,
    })

    const full = detectCapabilities({
      navigatorObj: {
        usb: {},
        bluetooth: { getDevices: async () => [] },
        storage: { persist: async () => true },
      },
      globalObj: {
        BarcodeDetector: function MockDetector() {},
        matchMedia: (q) => ({ matches: q === '(hover: hover)' }),
      },
    })
    expect(full).toEqual({
      webUsb: true,
      webBluetooth: true,
      webBluetoothPersistent: true,
      barcodeDetector: true,
      hoverPointer: true,
      persistentStorage: true,
    })
  })
})
