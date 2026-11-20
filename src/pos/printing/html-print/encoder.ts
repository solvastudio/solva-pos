import { renderReceiptDocText } from '../layout'
import type { ReceiptDoc } from '../receipt-doc'

export interface HtmlPrintEncodeOptions {
  readonly widthMm: 58 | 80
  readonly docObj?: Document
}

/**
 * Renders `ReceiptDoc` into a fixed-width monospace `<div id="receipt">` subtree
 * compatible with `@page` 58mm/80mm kiosk print CSS (`src/styles/receipt-print.css`).
 */
export function encodeReceiptHtml(
  doc: ReceiptDoc,
  opts: HtmlPrintEncodeOptions,
): HTMLElement {
  const columns: 32 | 48 = opts.widthMm === 80 ? 48 : 32
  const d = opts.docObj ?? document
  const root = d.createElement('div')
  root.id = 'receipt'
  root.className = opts.widthMm === 80 ? 'solva-receipt solva-receipt-80' : 'solva-receipt solva-receipt-58'

  const pre = d.createElement('pre')
  pre.className = 'solva-receipt-pre'
  pre.textContent = renderReceiptDocText(doc, columns)
  root.appendChild(pre)

  return root
}

export function renderReceiptHtmlString(doc: ReceiptDoc, widthMm: 58 | 80): string {
  const columns: 32 | 48 = widthMm === 80 ? 48 : 32
  const text = renderReceiptDocText(doc, columns)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const sizeCss = widthMm === 80 ? '80mm' : '58mm'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:${sizeCss} auto;margin:0}body{margin:0;padding:2mm;font-family:monospace;font-size:12px;line-height:1.25}pre{margin:0;white-space:pre}</style></head><body><div id="receipt"><pre>${text}</pre></div></body></html>`
}
