import { i18next } from '~/i18n'
import {
  formatNumberPlain,
  normalizeQty,
  parseQty,
  type LocaleId,
  type OutletTimezone,
} from '~/lib/kernel'
import type {
  CreditNoteLineRecord,
  CreditNoteRecord,
  CreditNoteRefundRecord,
  OutletReceiptSettingRecord,
  OutletRecord,
  SaleLineRecord,
  SalePaymentRecord,
  SaleRecord,
  ShiftRecord,
} from '~/pos/db/types'
import type { LocalShiftRecap } from '~/pos/domain/local-shift-recap'
import type { ReceiptDoc, ReceiptNode } from './receipt-doc'

function formatReceiptTimestamp(iso: string, tz: OutletTimezone): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(iso))
    .replace(',', '')
}

function appendHeaderNodes(
  nodes: ReceiptNode[],
  outlet: Pick<OutletRecord, 'name' | 'address' | 'phone'>,
  receiptSetting: Pick<OutletReceiptSettingRecord, 'header_text' | 'logo_sha256'> | null,
): void {
  if (receiptSetting?.logo_sha256) {
    nodes.push({ t: 'image', ref: 'logo' })
  }
  const rawHeader = receiptSetting?.header_text?.trim()
  if (rawHeader) {
    for (const line of rawHeader.split('\n')) {
      const clean = line.trim()
      if (clean) {
        nodes.push({ t: 'text', text: clean, align: 'center' })
      }
    }
    return
  }
  nodes.push({ t: 'text', text: outlet.name, align: 'center', bold: true })
  if (outlet.address) {
    nodes.push({ t: 'text', text: outlet.address, align: 'center' })
  }
  if (outlet.phone) {
    nodes.push({ t: 'text', text: outlet.phone, align: 'center' })
  }
}

function appendDateCashierNodes(
  nodes: ReceiptNode[],
  locale: LocaleId,
  iso: string,
  tz: OutletTimezone,
  cashierName: string,
): void {
  const t = i18next.getFixedT(locale)
  nodes.push({
    t: 'text',
    text: t('receipt.dateLabel', { date: formatReceiptTimestamp(iso, tz) }),
    align: 'left',
  })
  nodes.push({
    t: 'text',
    text: t('receipt.cashierLabel', { cashier: cashierName }),
    align: 'left',
  })
}

function formatReceiptTaxRate(rate: string): string {
  return rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate
}

function appendFooterNodes(
  nodes: ReceiptNode[],
  receiptSetting: Pick<OutletReceiptSettingRecord, 'footer_text'> | null,
  fallbackFooter: string,
): void {
  const rawFooter = receiptSetting?.footer_text?.trim()
  if (rawFooter) {
    for (const line of rawFooter.split('\n')) {
      const clean = line.trim()
      if (clean) {
        nodes.push({ t: 'text', text: clean, align: 'center' })
      }
    }
  } else {
    nodes.push({ t: 'text', text: fallbackFooter, align: 'center' })
  }
}

export interface BuildReceiptInput {
  readonly kind: 'RECEIPT' | 'REPRINT' | 'PREBILL'
  readonly sale: SaleRecord
  readonly lines: readonly SaleLineRecord[]
  readonly payments: readonly SalePaymentRecord[]
  readonly outlet: Pick<OutletRecord, 'name' | 'address' | 'phone' | 'timezone'>
  readonly receiptSetting: Pick<
    OutletReceiptSettingRecord,
    'header_text' | 'footer_text' | 'logo_sha256'
  > | null
  readonly registerCode?: string
  readonly cashierName: string
  readonly locale?: LocaleId
  readonly columns?: 32 | 48
  readonly includeRegisterLine?: boolean
}

/**
 * Builds an immutable, printer-neutral `ReceiptDoc` IR from stored sale records (BR-PRN-007).
 * Never reads `Date.now()`; `REPRINT` prepends `"CETAK ULANG"` / `"REPRINT"` in the stored `receipt_locale`.
 */
export function buildReceipt(input: BuildReceiptInput): ReceiptDoc {
  const locale: LocaleId =
    input.locale ?? (input.sale.receipt_locale === 'en-US' ? 'en-US' : 'id-ID')
  const t = i18next.getFixedT(locale)
  const tz = (input.outlet.timezone || 'Asia/Jakarta') as OutletTimezone
  const nodes: ReceiptNode[] = []

  if (input.kind === 'REPRINT') {
    nodes.push({ t: 'text', text: t('receipt.reprintBadge'), align: 'center', bold: true })
  } else if (input.kind === 'PREBILL') {
    nodes.push({ t: 'text', text: t('receipt.prebillBadge'), align: 'center', bold: true })
  }

  appendHeaderNodes(nodes, input.outlet, input.receiptSetting)
  nodes.push({ t: 'sep' })

  nodes.push({
    t: 'text',
    text: t('receipt.invoiceNoLabel', { no: input.sale.invoice_no }),
    align: 'left',
  })
  appendDateCashierNodes(nodes, locale, input.sale.occurred_at, tz, input.cashierName)
  if (input.includeRegisterLine && input.registerCode) {
    nodes.push({
      t: 'text',
      text: t('receipt.registerLabel', { code: input.registerCode }),
      align: 'left',
    })
  }
  nodes.push({ t: 'sep' })

  for (const line of input.lines) {
    nodes.push({ t: 'text', text: line.item_name, align: 'left' })
    const qtyText = normalizeQty(parseQty(line.qty))
    const leftDetail = ` ${qtyText} x ${formatNumberPlain(line.unit_price, locale)}`
    nodes.push({
      t: 'row',
      left: leftDetail,
      right: formatNumberPlain(line.line_gross, locale),
    })

    if (line.line_discount > 0) {
      const discLabel =
        line.discount_type === 'PERCENT' && line.discount_pct
          ? `${line.discount_pct}%`
          : ''
      const rowLeft = discLabel
        ? ` ${t('receipt.lineDiscount', { label: discLabel })}`
        : ` ${t('receipt.lineDiscount', { label: '' }).trimEnd()}`
      nodes.push({
        t: 'row',
        left: rowLeft,
        right: formatNumberPlain(-line.line_discount, locale),
      })
    }
  }
  nodes.push({ t: 'sep' })

  nodes.push({
    t: 'row',
    left: t('receipt.subtotal'),
    right: formatNumberPlain(input.sale.net_subtotal, locale),
  })

  if (input.sale.bill_discount_total > 0) {
    nodes.push({
      t: 'row',
      left: t('receipt.billDiscount'),
      right: formatNumberPlain(-input.sale.bill_discount_total, locale),
    })
  }

  if (input.sale.service_charge > 0) {
    nodes.push({
      t: 'row',
      left: t('receipt.serviceCharge'),
      right: formatNumberPlain(input.sale.service_charge, locale),
    })
  }

  if (
    input.sale.tax_profile !== 'NONE' &&
    input.sale.price_tax_mode !== 'INCLUSIVE' &&
    (input.sale.tax_amount > 0 || Number(input.sale.tax_rate) > 0)
  ) {
    const label = t('receipt.taxLine', {
      profile: input.sale.tax_profile,
      rate: formatReceiptTaxRate(input.sale.tax_rate),
    })
    nodes.push({
      t: 'row',
      left: label,
      right: formatNumberPlain(input.sale.tax_amount, locale),
    })
  }

  if (input.sale.rounding !== 0) {
    nodes.push({
      t: 'row',
      left: t('receipt.rounding'),
      right: formatNumberPlain(input.sale.rounding, locale),
    })
  }

  nodes.push({
    t: 'row',
    left: t('receipt.total'),
    right: formatNumberPlain(input.sale.total_due, locale),
    bold: true,
  })

  let totalChange = 0
  for (const pay of input.payments) {
    const tendered = pay.method_kind === 'CASH' && pay.cash_tendered !== null
      ? pay.cash_tendered
      : pay.amount_applied
    const label =
      pay.method_kind === 'CASH'
        ? t('receipt.cashMethod')
        : pay.reference
          ? `${pay.method_name}${t('receipt.refSuffix', { ref: pay.reference })}`
          : pay.method_name
    nodes.push({
      t: 'row',
      left: label,
      right: formatNumberPlain(tendered, locale),
    })
    if (pay.change_given && pay.change_given > 0) {
      totalChange += pay.change_given
    }
  }

  if (totalChange > 0) {
    nodes.push({
      t: 'row',
      left: t('receipt.change'),
      right: formatNumberPlain(totalChange, locale),
    })
  }

  if (input.sale.customer_name) {
    nodes.push({ t: 'sep' })
    nodes.push({
      t: 'text',
      text: t('receipt.customer', { name: input.sale.customer_name }),
      align: 'left',
    })
  }

  nodes.push({ t: 'sep' })
  appendFooterNodes(nodes, input.receiptSetting, t('receipt.footerDefault'))
  nodes.push({ t: 'feed', lines: 3 })
  nodes.push({ t: 'cut' })

  return nodes
}

export interface BuildCreditNoteReceiptInput {
  readonly creditNote: CreditNoteRecord
  readonly lines: readonly (CreditNoteLineRecord & { readonly item_name: string; readonly uom_code: string })[]
  readonly refunds: readonly CreditNoteRefundRecord[]
  readonly outlet: Pick<OutletRecord, 'name' | 'address' | 'phone' | 'timezone'>
  readonly receiptSetting: Pick<
    OutletReceiptSettingRecord,
    'header_text' | 'footer_text' | 'logo_sha256'
  > | null
  readonly cashierName: string
  readonly isReprint?: boolean
}

export function buildCreditNoteReceipt(input: BuildCreditNoteReceiptInput): ReceiptDoc {
  const locale: LocaleId = input.creditNote.receipt_locale === 'en-US' ? 'en-US' : 'id-ID'
  const t = i18next.getFixedT(locale)
  const tz = (input.outlet.timezone || 'Asia/Jakarta') as OutletTimezone
  const nodes: ReceiptNode[] = []

  if (input.isReprint) {
    nodes.push({ t: 'text', text: t('receipt.reprintBadge'), align: 'center', bold: true })
  }

  appendHeaderNodes(nodes, input.outlet, input.receiptSetting)
  nodes.push({ t: 'sep' })

  nodes.push({
    t: 'text',
    text: t('receipt.creditNoteNoLabel', { no: input.creditNote.cn_no }),
    align: 'left',
  })
  nodes.push({
    t: 'text',
    text: t('receipt.origInvoiceLabel', { no: input.creditNote.original_invoice_no }),
    align: 'left',
  })
  appendDateCashierNodes(nodes, locale, input.creditNote.occurred_at, tz, input.cashierName)
  nodes.push({ t: 'sep' })

  for (const line of input.lines) {
    nodes.push({ t: 'text', text: line.item_name, align: 'left' })
    const qtyStr = normalizeQty(parseQty(line.qty_returned))
    nodes.push({
      t: 'row',
      left: ` ${qtyStr} ${line.uom_code}`,
      right: formatNumberPlain(line.refund_net, locale),
    })
  }
  nodes.push({ t: 'sep' })

  nodes.push({
    t: 'row',
    left: t('receipt.subtotal'),
    right: formatNumberPlain(input.creditNote.net_total, locale),
  })
  if (input.creditNote.price_tax_mode !== 'INCLUSIVE' && input.creditNote.tax_total > 0) {
    nodes.push({
      t: 'row',
      left: t('receipt.taxLine', { profile: 'PPN', rate: '' }).trim(),
      right: formatNumberPlain(input.creditNote.tax_total, locale),
    })
  }
  if (input.creditNote.rounding !== 0) {
    nodes.push({
      t: 'row',
      left: t('receipt.rounding'),
      right: formatNumberPlain(input.creditNote.rounding, locale),
    })
  }
  const totalRefund = input.refunds.reduce((sum, r) => sum + r.amount_applied, 0) || input.creditNote.refund_gross
  nodes.push({
    t: 'row',
    left: t('receipt.refundTotal'),
    right: formatNumberPlain(totalRefund, locale),
    bold: true,
  })
  for (const refund of input.refunds) {
    nodes.push({
      t: 'row',
      left: refund.method_kind === 'CASH' ? t('receipt.cashMethod') : refund.method_name,
      right: formatNumberPlain(refund.amount_applied, locale),
    })
  }

  nodes.push({ t: 'sep' })
  appendFooterNodes(nodes, input.receiptSetting, t('receipt.footerDefault'))
  nodes.push({ t: 'feed', lines: 3 })
  nodes.push({ t: 'cut' })
  return nodes
}

export interface BuildShiftRecapInput {
  readonly shift: ShiftRecord
  readonly recap: LocalShiftRecap
  readonly outlet: Pick<OutletRecord, 'name' | 'address' | 'phone' | 'timezone'>
  readonly registerCode: string
  readonly cashierName: string
  readonly locale: LocaleId
}

/**
 * Builds shift close recap receipt. Expected cash & variance are strictly omitted unless
 * count has been submitted (`shift.status !== 'OPEN'` and `counted_cash !== null`).
 */
export function buildShiftRecap(input: BuildShiftRecapInput): ReceiptDoc {
  const t = i18next.getFixedT(input.locale)
  const tz = (input.outlet.timezone || 'Asia/Jakarta') as OutletTimezone
  const nodes: ReceiptNode[] = [
    { t: 'text', text: t('receipt.shiftRecapTitle'), align: 'center', bold: true },
    { t: 'text', text: input.outlet.name, align: 'center' },
    { t: 'sep' },
    { t: 'text', text: t('receipt.registerLabel', { code: input.registerCode }) },
  ]
  appendDateCashierNodes(
    nodes,
    input.locale,
    input.shift.closed_at ?? input.shift.occurred_at,
    tz,
    input.cashierName,
  )
  nodes.push(
    { t: 'sep' },
    { t: 'row', left: t('receipt.openingCash'), right: formatNumberPlain(input.recap.openingCash, input.locale) },
    { t: 'row', left: t('receipt.cashSales'), right: formatNumberPlain(input.recap.cashSalesTotal, input.locale) },
    { t: 'row', left: t('receipt.cashIn'), right: formatNumberPlain(input.recap.cashInTotal, input.locale) },
    { t: 'row', left: t('receipt.cashOut'), right: formatNumberPlain(input.recap.cashOutTotal, input.locale) },
    { t: 'row', left: t('receipt.cashRefunds'), right: formatNumberPlain(input.recap.cashRefundsTotal, input.locale) },
  )

  const countSubmitted = input.shift.status !== 'OPEN' && input.shift.counted_cash !== null
  if (countSubmitted) {
    const variance = (input.shift.counted_cash ?? 0) - input.recap.expectedCash
    nodes.push({ t: 'sep' })
    nodes.push({ t: 'row', left: t('receipt.expectedCash'), right: formatNumberPlain(input.recap.expectedCash, input.locale) })
    nodes.push({ t: 'row', left: t('receipt.countedCash'), right: formatNumberPlain(input.shift.counted_cash!, input.locale) })
    nodes.push({ t: 'row', left: t('receipt.variance'), right: formatNumberPlain(variance, input.locale), bold: true })
  }

  const nonCash = input.recap.methods.filter((m) => m.kind === 'NON_CASH')
  if (nonCash.length > 0) {
    nodes.push({ t: 'sep' })
    nodes.push({ t: 'text', text: t('receipt.nonCashHeader'), bold: true })
    for (const m of nonCash) {
      nodes.push({ t: 'row', left: m.methodName, right: formatNumberPlain(m.totalApplied, input.locale) })
    }
  }

  nodes.push({ t: 'sep' })
  nodes.push({ t: 'feed', lines: 3 })
  nodes.push({ t: 'cut' })
  return nodes
}

export function buildTestPage(input: {
  readonly locale: LocaleId
  readonly paperWidthMm: 58 | 80
  readonly columns: 32 | 48
  readonly outletName?: string
  readonly registerCode?: string
}): ReceiptDoc {
  const t = i18next.getFixedT(input.locale)
  return [
    { t: 'text', text: t('receipt.testTitle'), align: 'center', bold: true, size: 'double' },
    { t: 'sep' },
    { t: 'text', text: t('receipt.testPrinterOk'), align: 'center', bold: true },
    ...(input.outletName ? [{ t: 'text', text: input.outletName, align: 'center' } as ReceiptNode] : []),
    ...(input.registerCode
      ? [{ t: 'text', text: t('receipt.registerLabel', { code: input.registerCode }), align: 'center' } as ReceiptNode]
      : []),
    {
      t: 'row',
      left: t('receipt.testPaperWidth', { width: input.paperWidthMm, cols: input.columns }),
      right: `${input.columns}`,
    },
    { t: 'qr', data: `SOLVA-TEST-${input.paperWidthMm}MM` },
    { t: 'sep' },
    { t: 'feed', lines: 3 },
    { t: 'cut' },
  ]
}
