// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildReceipt } from '../receipt-builder'
import { createContoh1Sample } from '../receipt-builder.test'
import { encodeReceiptHtml, renderReceiptHtmlString } from './encoder'

describe('pos/printing/html-print/encoder', () => {
  it('renders HTML kiosk monospace receipt matching golden text', () => {
    const sample = createContoh1Sample()
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

    const el = encodeReceiptHtml(doc, { widthMm: 58 })
    expect(el.id).toBe('receipt')
    const golden = readFileSync(
      resolve(process.cwd(), 'tests/fixtures/receipt-contoh1.golden.txt'),
      'utf8',
    ).replace(/\r\n/g, '\n').trimEnd()
    expect(el.textContent).toBe(golden)

    const htmlStr = renderReceiptHtmlString(doc, 80)
    expect(htmlStr).toContain('@page{size:80mm auto;margin:0}')
  })
})
