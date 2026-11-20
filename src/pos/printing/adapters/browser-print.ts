import { renderReceiptHtmlString } from '../html-print/encoder'
import type { PrinterCapabilities } from '../printer-profiles'
import {
  PrinterAdapterError,
  type PrinterAdapter,
  type PrinterState,
  type PrinterStatusResult,
  type PrintJobPayload,
  type PrintResult,
} from './types'

export class BrowserPrintAdapter implements PrinterAdapter {
  readonly kind = 'browser-print' as const
  readonly capabilities: PrinterCapabilities
  private readonly printFn?: (html: string, widthMm: 58 | 80) => Promise<void>

  constructor(opts: {
    paperWidthMm?: 58 | 80
    printHtml?: (html: string, widthMm: 58 | 80) => Promise<void>
  } = {}) {
    const widthMm = opts.paperWidthMm ?? 80
    this.capabilities = {
      paperWidthMm: widthMm,
      columns: widthMm === 80 ? 48 : 32,
      canCut: false,
      canOpenDrawer: false,
      supportsNvLogo: false,
      maxWriteBytes: 65536,
      writePacingMs: 0,
      codePage: 'UTF-8',
    }
    this.printFn = opts.printHtml
  }

  state(): PrinterState {
    return 'READY'
  }

  async connect(_opts: { userGesture: boolean }): Promise<void> {
    // OS / kiosk print uses browser's configured default printer without WebUSB/BLE pairing.
  }

  async print(job: PrintJobPayload): Promise<PrintResult> {
    if (!job.doc) {
      throw new PrinterAdapterError('ENCODE_ERROR', 'BrowserPrintAdapter requires ReceiptDoc')
    }
    const widthMm = job.paperWidthMm ?? this.capabilities.paperWidthMm
    const html = renderReceiptHtmlString(job.doc, widthMm)
    const firstByteAtIso = new Date().toISOString()

    if (this.printFn) {
      await this.printFn(html, widthMm)
      return {
        ok: true,
        firstByteAtIso,
        doneAtIso: new Date().toISOString(),
        bytesSent: html.length,
      }
    }

    if (typeof document === 'undefined') {
      throw new PrinterAdapterError('UNSUPPORTED', 'Browser DOM unavailable')
    }

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.setAttribute('aria-hidden', 'true')
    document.body.appendChild(iframe)

    try {
      const win = iframe.contentWindow
      if (!win) {
        throw new PrinterAdapterError('UNSUPPORTED', 'Print frame unavailable')
      }
      win.document.open()
      win.document.write(html)
      win.document.close()
      win.focus()
      win.print()
    } finally {
      setTimeout(() => {
        iframe.remove()
      }, 1000)
    }

    return {
      ok: true,
      firstByteAtIso,
      doneAtIso: new Date().toISOString(),
      bytesSent: html.length,
    }
  }

  async openDrawer(): Promise<void> {
    throw new PrinterAdapterError(
      'UNSUPPORTED',
      'Browser print does not support ESC/POS cash drawer control',
    )
  }

  async status(): Promise<PrinterStatusResult> {
    return { online: true }
  }

  async disconnect(): Promise<void> {
    // No persistent hardware session to close.
  }
}
