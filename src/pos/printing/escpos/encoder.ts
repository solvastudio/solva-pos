import { alignLine, rowLeftRight, separatorLine, wrapText } from '../layout'
import type { PrinterProfile } from '../printer-profiles'
import type { RasterAsset, ReceiptAlign, ReceiptDoc } from '../receipt-doc'
import { transliterateToAscii } from '../transliterate'

const ESC = 0x1b
const FS = 0x1c
const GS = 0x1d

const ALIGN_BYTE: Record<ReceiptAlign, number> = {
  left: 0,
  center: 1,
  right: 2,
}

class ByteBuilder {
  private readonly buf: number[] = []

  push(...bytes: number[]): void {
    for (const b of bytes) {
      this.buf.push(b & 0xff)
    }
  }

  pushBytes(arr: Uint8Array): void {
    for (const b of arr) {
      this.buf.push(b & 0xff)
    }
  }

  pushAsciiLine(text: string): void {
    const clean = transliterateToAscii(text)
    for (let i = 0; i < clean.length; i++) {
      this.buf.push(clean.charCodeAt(i) & 0x7f)
    }
    this.buf.push(0x0a)
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buf)
  }
}

export interface EscPosEncodeOptions {
  readonly logo?: RasterAsset | null
  readonly drawerPulse?: readonly [number, number, number]
}

/**
 * Pure ESC/POS byte encoder (no third-party dependencies, AD-18):
 * supports init (`ESC @`), code page (`ESC t`), align (`ESC a`), bold (`ESC E`),
 * double size (`GS !`), 1-bit raster (`GS v 0`) / NV logo (`FS p`),
 * QR (`GS ( k`), line feed (`ESC d`), partial cut (`GS V`), and cash drawer pulse (`ESC p`).
 */
export function encodeEscPos(
  doc: ReceiptDoc,
  profile: PrinterProfile,
  opts: EscPosEncodeOptions = {},
): Uint8Array {
  const out = new ByteBuilder()
  const cols = profile.capabilities.columns
  let curAlign: ReceiptAlign = 'left'
  let curBold = false
  let curDouble = false

  function setAlign(align: ReceiptAlign): void {
    if (align !== curAlign) {
      out.push(ESC, 0x61, ALIGN_BYTE[align])
      curAlign = align
    }
  }

  function setBold(bold: boolean): void {
    if (bold !== curBold) {
      out.push(ESC, 0x45, bold ? 1 : 0)
      curBold = bold
    }
  }

  function setDouble(doubleSize: boolean): void {
    if (doubleSize !== curDouble) {
      out.push(GS, 0x21, doubleSize ? 0x11 : 0x00)
      curDouble = doubleSize
    }
  }

  // Init & select code page
  out.push(ESC, 0x40)
  out.push(ESC, 0x74, profile.escCodePageByte)

  for (const node of doc) {
    switch (node.t) {
      case 'text': {
        const align = node.align ?? 'left'
        const bold = Boolean(node.bold)
        const doubleSize = node.size === 'double'
        setAlign(align)
        setBold(bold)
        setDouble(doubleSize)
        const effCols = doubleSize ? Math.max(1, Math.floor(cols / 2)) : cols
        for (const line of wrapText(node.text, effCols)) {
          out.pushAsciiLine(line)
        }
        break
      }
      case 'row': {
        setAlign('left')
        setDouble(false)
        setBold(Boolean(node.bold))
        for (const line of rowLeftRight(node.left, node.right, cols)) {
          out.pushAsciiLine(line)
        }
        break
      }
      case 'sep': {
        setAlign('left')
        setBold(false)
        setDouble(false)
        out.pushAsciiLine(separatorLine(cols))
        break
      }
      case 'image': {
        setBold(false)
        setDouble(false)
        setAlign('center')
        if (profile.capabilities.supportsNvLogo) {
          out.push(FS, 0x70, 0x01, 0x00)
        } else if (opts.logo && opts.logo.width > 0 && opts.logo.height > 0) {
          const widthBytes = Math.ceil(opts.logo.width / 8)
          const xL = widthBytes & 0xff
          const xH = (widthBytes >> 8) & 0xff
          const yL = opts.logo.height & 0xff
          const yH = (opts.logo.height >> 8) & 0xff
          out.push(GS, 0x76, 0x30, 0x00, xL, xH, yL, yH)
          out.pushBytes(opts.logo.bits.subarray(0, widthBytes * opts.logo.height))
        }
        break
      }
      case 'qr': {
        setBold(false)
        setDouble(false)
        setAlign('center')
        const qrText = transliterateToAscii(node.data)
        const dataBytes = new TextEncoder().encode(qrText)
        const pLen = dataBytes.length + 3
        // Function 165: QR model 2
        out.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00)
        // Function 167: Module size 4
        out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x04)
        // Function 169: ECC M
        out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31)
        // Function 180: Store data
        out.push(GS, 0x28, 0x6b, pLen & 0xff, (pLen >> 8) & 0xff, 0x31, 0x50, 0x30)
        out.pushBytes(dataBytes)
        // Function 181: Print QR
        out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30)
        break
      }
      case 'feed': {
        setBold(false)
        setDouble(false)
        setAlign('left')
        const count = Math.max(1, Math.min(255, Math.floor(node.lines)))
        out.push(ESC, 0x64, count)
        break
      }
      case 'cut': {
        if (profile.capabilities.canCut) {
          setBold(false)
          setDouble(false)
          out.push(GS, 0x56, 0x42, 0x00)
        }
        break
      }
      case 'drawer': {
        if (profile.capabilities.canOpenDrawer) {
          const [m, t1, t2] = opts.drawerPulse ?? profile.drawerPulse
          out.push(ESC, 0x70, m & 0xff, t1 & 0xff, t2 & 0xff)
        }
        break
      }
    }
  }

  return out.toUint8Array()
}

export function encodeCashDrawerPulse(
  profile: PrinterProfile,
  pulse?: readonly [number, number, number],
): Uint8Array {
  if (!profile.capabilities.canOpenDrawer) {
    return new Uint8Array(0)
  }
  const [m, t1, t2] = pulse ?? profile.drawerPulse
  return new Uint8Array([ESC, 0x40, ESC, 0x70, m & 0xff, t1 & 0xff, t2 & 0xff])
}

/**
 * Helper to format centered header preview strings exactly matching alignment rules.
 */
export function formatAlignedHeaderLine(line: string, columns: number): string {
  return alignLine(transliterateToAscii(line), columns, 'center')
}
