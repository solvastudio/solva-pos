import { describe, expect, it } from 'vitest'
import { WedgeBuffer } from './wedge-buffer'

describe('pos/scanner/wedge-buffer', () => {
  it('detects rapid HID barcode bursts (< 50ms per char, >= 4 chars) terminated by Enter', () => {
    let t = 1000
    const buf = new WedgeBuffer({ nowMs: () => t })

    const digits = '8991002101234'
    for (const ch of digits) {
      t += 12
      const res = buf.push({ key: ch })
      expect(res.matched).toBeNull()
    }
    t += 15
    const end = buf.push({ key: 'Enter' })
    expect(end).toEqual({ matched: '8991002101234', consumed: true })
  })

  it('ignores slow human typing (>= 50ms inter-key gap) and short sequences', () => {
    let t = 1000
    const buf = new WedgeBuffer({ nowMs: () => t })

    for (const ch of '123456') {
      t += 65
      buf.push({ key: ch })
    }
    t += 15
    expect(buf.push({ key: 'Enter' })).toEqual({ matched: null, consumed: false })

    // Short burst (< 4 chars)
    for (const ch of 'abc') {
      t += 10
      buf.push({ key: ch })
    }
    t += 10
    expect(buf.push({ key: 'Enter' })).toEqual({ matched: null, consumed: false })
  })

  it('resets when modifier keys are pressed', () => {
    let t = 1000
    const buf = new WedgeBuffer({ nowMs: () => t })
    for (const ch of '8991') {
      t += 10
      buf.push({ key: ch })
    }
    t += 10
    buf.push({ key: 'k', ctrlKey: true })
    t += 10
    expect(buf.push({ key: 'Enter' })).toEqual({ matched: null, consumed: false })
  })
})
