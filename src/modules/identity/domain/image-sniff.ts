export const MAX_LOGO_BYTES = 200 * 1024
export const MAX_LOGO_DIMENSION = 1024

export interface SniffedImage {
  readonly ext: 'png' | 'jpg'
  readonly mimeType: 'image/png' | 'image/jpeg'
  readonly width: number
  readonly height: number
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

function startsWithPng(bytes: Uint8Array): boolean {
  if (bytes.length < 24) return false
  for (let i = 0; i < PNG_SIG.length; i += 1) {
    if (bytes[i] !== PNG_SIG[i]) return false
  }
  // Must have IHDR chunk right after 8-byte PNG signature
  return (
    bytes[12] === 0x49 && // 'I'
    bytes[13] === 0x48 && // 'H'
    bytes[14] === 0x44 && // 'D'
    bytes[15] === 0x52 // 'R'
  )
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) >>> 0) +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  )
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) + bytes[offset + 1]!
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return null
  }
  let pos = 2
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos += 1
      continue
    }
    while (pos < bytes.length && bytes[pos] === 0xff) {
      pos += 1
    }
    if (pos >= bytes.length) break
    const marker = bytes[pos]!
    pos += 1

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }
    if (pos + 2 > bytes.length) break
    const segLen = readUint16BE(bytes, pos)
    if (segLen < 2 || pos + segLen > bytes.length) break

    // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2), SOF3 (0xC3)
    if (marker >= 0xc0 && marker <= 0xc3) {
      if (pos + 7 > bytes.length) break
      const height = readUint16BE(bytes, pos + 3)
      const width = readUint16BE(bytes, pos + 5)
      return { width, height }
    }
    pos += segLen
  }
  return null
}

/**
 * Pure magic-byte image inspector (zero external image codecs):
 * - Enforces byte length `1 .. 204800` (200 KB)
 * - Accepts ONLY valid PNG or JPEG with `1..1024 x 1..1024` dimensions
 * - Rejects SVG, XML, GIF, WebP, or spoofed headers.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage {
  if (bytes.byteLength === 0) {
    throw new Error('Empty image payload')
  }
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new Error(`Image exceeds ${MAX_LOGO_BYTES} byte limit`)
  }

  if (startsWithPng(bytes)) {
    const width = readUint32BE(bytes, 16)
    const height = readUint32BE(bytes, 20)
    if (width < 1 || height < 1 || width > MAX_LOGO_DIMENSION || height > MAX_LOGO_DIMENSION) {
      throw new Error(`PNG dimensions ${width}x${height} exceed ${MAX_LOGO_DIMENSION}x${MAX_LOGO_DIMENSION}`)
    }
    return {
      ext: 'png',
      mimeType: 'image/png',
      width,
      height,
    }
  }

  const jpg = parseJpegDimensions(bytes)
  if (jpg) {
    if (
      jpg.width < 1 ||
      jpg.height < 1 ||
      jpg.width > MAX_LOGO_DIMENSION ||
      jpg.height > MAX_LOGO_DIMENSION
    ) {
      throw new Error(
        `JPEG dimensions ${jpg.width}x${jpg.height} exceed ${MAX_LOGO_DIMENSION}x${MAX_LOGO_DIMENSION}`,
      )
    }
    return {
      ext: 'jpg',
      mimeType: 'image/jpeg',
      width: jpg.width,
      height: jpg.height,
    }
  }

  throw new Error('Unsupported or invalid image format (only PNG/JPEG allowed)')
}
