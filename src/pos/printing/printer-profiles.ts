export interface PrinterCapabilities {
  readonly paperWidthMm: 58 | 80
  readonly columns: 32 | 48
  readonly canCut: boolean
  readonly canOpenDrawer: boolean
  readonly supportsNvLogo: boolean
  readonly maxWriteBytes: number
  readonly writePacingMs: number
  readonly codePage: string
}

export interface PrinterProfile {
  readonly id: string
  readonly name: string
  readonly escCodePageByte: number
  readonly capabilities: PrinterCapabilities
  readonly drawerPulse: readonly [number, number, number]
  readonly bleServiceUuid?: string
  readonly bleCharacteristicUuid?: string
}

export const PRINTER_PROFILES: readonly PrinterProfile[] = [
  {
    id: 'escpos-58',
    name: 'Generic 58mm Thermal (USB/ESC-POS)',
    escCodePageByte: 0,
    drawerPulse: [0, 60, 120],
    capabilities: {
      paperWidthMm: 58,
      columns: 32,
      canCut: true,
      canOpenDrawer: true,
      supportsNvLogo: false,
      maxWriteBytes: 64,
      writePacingMs: 5,
      codePage: 'CP437',
    },
  },
  {
    id: 'escpos-80',
    name: 'Generic 80mm Thermal (USB/ESC-POS)',
    escCodePageByte: 0,
    drawerPulse: [0, 60, 120],
    capabilities: {
      paperWidthMm: 80,
      columns: 48,
      canCut: true,
      canOpenDrawer: true,
      supportsNvLogo: false,
      maxWriteBytes: 64,
      writePacingMs: 5,
      codePage: 'CP437',
    },
  },
  {
    id: 'ble-generic',
    name: 'Generic BLE Thermal (58/80mm)',
    escCodePageByte: 0,
    drawerPulse: [0, 60, 120],
    bleServiceUuid: '000018f0-0000-1000-8000-00805f9b34fb',
    bleCharacteristicUuid: '00002af1-0000-1000-8000-00805f9b34fb',
    capabilities: {
      paperWidthMm: 58,
      columns: 32,
      canCut: false,
      canOpenDrawer: true,
      supportsNvLogo: false,
      maxWriteBytes: 20,
      writePacingMs: 25,
      codePage: 'CP437',
    },
  },
] as const

export function findPrinterProfile(profileId: string | undefined): PrinterProfile {
  return (
    PRINTER_PROFILES.find((p) => p.id === profileId) ??
    PRINTER_PROFILES[0]!
  )
}

export function columnsForPaperWidth(widthMm: 58 | 80): 32 | 48 {
  return widthMm === 80 ? 48 : 32
}
