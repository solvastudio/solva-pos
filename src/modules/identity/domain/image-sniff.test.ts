import { describe, expect, it } from 'vitest'
import { MAX_LOGO_BYTES, sniffImage } from './image-sniff'

export function makeSyntheticPng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  // Chunk length (13) + 'IHDR'
  buf.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  buf[16] = (width >>> 24) & 0xff
  buf[17] = (width >>> 16) & 0xff
  buf[18] = (width >>> 8) & 0xff
  buf[19] = width & 0xff
  buf[20] = (height >>> 24) & 0xff
  buf[21] = (height >>> 16) & 0xff
  buf[22] = (height >>> 8) & 0xff
  buf[23] = height & 0xff
  return buf
}

export function makeSyntheticJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 dummy
    0xff, 0xc0, // SOF0
    0x00, 0x0b, // length
    0x08, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00,
    0xff, 0xd9, // EOI
  ])
}

describe('image-sniff', () => {
  it('accepts valid PNG & JPEG within 1024x1024 and <= 200 KB', () => {
    expect(sniffImage(makeSyntheticPng(256, 128))).toEqual({
      ext: 'png',
      mimeType: 'image/png',
      width: 256,
      height: 128,
    })

    expect(sniffImage(makeSyntheticJpeg(512, 512))).toEqual({
      ext: 'jpg',
      mimeType: 'image/jpeg',
      width: 512,
      height: 512,
    })
  })

  it('rejects SVG, > 200 KB files, oversized dimensions, and spoofed magic bytes', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(() => sniffImage(svg)).toThrow()

    const tooBig = new Uint8Array(MAX_LOGO_BYTES + 1)
    tooBig.set(makeSyntheticPng(64, 64), 0)
    expect(() => sniffImage(tooBig)).toThrow(/limit/)

    expect(() => sniffImage(makeSyntheticPng(1025, 100))).toThrow(/exceed/)
    expect(() => sniffImage(makeSyntheticJpeg(100, 2048))).toThrow(/exceed/)

    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00])
    expect(() => sniffImage(fakePng)).toThrow()
  })
})
