export interface RuntimeCapabilities {
  readonly webUsb: boolean
  readonly webBluetooth: boolean
  readonly webBluetoothPersistent: boolean
  readonly barcodeDetector: boolean
  readonly hoverPointer: boolean
  readonly persistentStorage: boolean
}

export interface CapabilitiesInput {
  readonly navigatorObj?: {
    usb?: unknown
    bluetooth?: { getDevices?: unknown }
    storage?: { persist?: unknown }
  } | null
  readonly globalObj?: {
    BarcodeDetector?: unknown
    matchMedia?: (q: string) => { matches: boolean }
  } | null
}

/**
 * Pure feature-based capability detection (no user-agent sniffing).
 */
export function detectCapabilities(input: CapabilitiesInput = {}): RuntimeCapabilities {
  const nav =
    input.navigatorObj !== undefined
      ? input.navigatorObj
      : typeof navigator !== 'undefined'
        ? (navigator as unknown as CapabilitiesInput['navigatorObj'])
        : null
  const glob =
    input.globalObj !== undefined
      ? input.globalObj
      : typeof globalThis !== 'undefined'
        ? (globalThis as unknown as CapabilitiesInput['globalObj'])
        : null

  const webUsb = Boolean(nav && 'usb' in nav && nav.usb != null)
  const bt = nav && 'bluetooth' in nav ? nav.bluetooth : undefined
  const webBluetooth = Boolean(bt)
  const webBluetoothPersistent = Boolean(bt && typeof bt.getDevices === 'function')
  const barcodeDetector = Boolean(glob && typeof glob.BarcodeDetector === 'function')
  const hoverPointer = Boolean(
    glob &&
      typeof glob.matchMedia === 'function' &&
      glob.matchMedia('(hover: hover)').matches,
  )
  const persistentStorage = Boolean(
    nav && nav.storage && typeof nav.storage.persist === 'function',
  )

  return {
    webUsb,
    webBluetooth,
    webBluetoothPersistent,
    barcodeDetector,
    hoverPointer,
    persistentStorage,
  }
}
