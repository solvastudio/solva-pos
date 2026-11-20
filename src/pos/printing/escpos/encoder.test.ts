import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findPrinterProfile } from '../printer-profiles'
import { buildReceipt, buildTestPage } from '../receipt-builder'
import { createContoh1Sample } from '../receipt-builder.test'
import { encodeCashDrawerPulse, encodeEscPos } from './encoder'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('pos/printing/escpos/encoder', () => {
  it('matches Contoh 1 golden binary vector and keeps size <= 2KB without unexpected control bytes', () => {
    const sample = createContoh1Sample()
    const profile = findPrinterProfile('escpos-58')
    const doc = buildReceipt({
      kind: 'RECEIPT',
      sale: sample.sale,
      lines: sample.lines,
      payments: sample.payments,
      outlet: sample.outlet,
      receiptSetting: sample.receiptSetting,
      cashierName: 'Dewi',
      locale: 'id-ID',
      columns: 32,
    })

    const bytes = encodeEscPos(doc, profile)
    const goldenHex = readFileSync(
      resolve(process.cwd(), 'tests/fixtures/receipt-contoh1.golden.hex'),
      'utf8',
    ).replace(/\s+/g, '')
    expect(toHex(bytes)).toBe(goldenHex)

    // <= 2 KB for <= 40-line receipt
    expect(bytes.length).toBeLessThanOrEqual(2048)

    // Starts with ESC @ (1b 40) + ESC t 0 (1b 74 00) and ends with GS V 66 0 (1d 56 42 00)
    expect(bytes[0]).toBe(0x1b)
    expect(bytes[1]).toBe(0x40)
    expect(bytes[bytes.length - 4]).toBe(0x1d)
    expect(bytes[bytes.length - 3]).toBe(0x56)
    expect(bytes[bytes.length - 2]).toBe(0x42)
    expect(bytes[bytes.length - 1]).toBe(0x00)
  })

  it('encodes raster GS v 0 logos, NV FS p logos, QR GS ( k, and ESC p drawer pulse', () => {
    const testDoc = buildTestPage({
      locale: 'id-ID',
      paperWidthMm: 58,
      columns: 32,
      outletName: 'SOLVA',
    })
    const profile = findPrinterProfile('escpos-58')
    const withImage = [{ t: 'image' as const, ref: 'logo' as const }, ...testDoc]

    const rasterBytes = encodeEscPos(withImage, profile, {
      logo: { width: 8, height: 2, bits: new Uint8Array([0xff, 0xaa]) },
    })
    // GS v 0 marker (1d 76 30) present for raster logo
    const rasterHex = toHex(rasterBytes)
    expect(rasterHex).toContain('1d7630')
    // GS ( k QR store marker present
    expect(rasterHex).toContain('1d286b')

    const nvProfile = {
      ...profile,
      capabilities: { ...profile.capabilities, supportsNvLogo: true },
    }
    const nvBytes = encodeEscPos(withImage, nvProfile)
    expect(toHex(nvBytes)).toContain('1c700100')

    const drawerPulse = encodeCashDrawerPulse(profile)
    expect(Array.from(drawerPulse)).toEqual([0x1b, 0x40, 0x1b, 0x70, 0, 60, 120])
  })
})
