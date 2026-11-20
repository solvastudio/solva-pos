import { describe, expect, it } from 'vitest'
import { columnsForPaperWidth, findPrinterProfile, PRINTER_PROFILES } from './printer-profiles'

describe('pos/printing/printer-profiles', () => {
  it('provides generic 58mm, 80mm, and ble-generic profiles with accurate column & chunk limits', () => {
    expect(columnsForPaperWidth(58)).toBe(32)
    expect(columnsForPaperWidth(80)).toBe(48)
    expect(PRINTER_PROFILES.length).toBeGreaterThanOrEqual(3)

    const p58 = findPrinterProfile('escpos-58')
    expect(p58.capabilities.columns).toBe(32)
    expect(p58.capabilities.canCut).toBe(true)

    const pBle = findPrinterProfile('ble-generic')
    expect(pBle.bleServiceUuid).toBeTruthy()
    expect(pBle.bleCharacteristicUuid).toBeTruthy()
    expect(pBle.capabilities.maxWriteBytes).toBeLessThanOrEqual(20)
  })
})
