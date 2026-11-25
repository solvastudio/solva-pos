import { i18next } from '~/i18n'
import {
  formatNumberPlain,
  normalizeQty,
  parseQty,
  type LocaleId,
  type OutletTimezone,
} from '~/lib/kernel'
import type { OutletReceiptSettingRecord, OutletRecord } from '~/pos/db/types'
import type { BillDiscountFields, BillItemTotalFields, BillTotalsView } from '../domain/bill-totals'
import type { ReceiptDoc, ReceiptNode } from './receipt-doc'

export interface PrebillItemInput extends BillItemTotalFields {
  readonly item_name: string
  readonly modifiers?: readonly { name: string; price_delta: number; qty: number }[]
}

export interface BuildPrebillDocInput {
  readonly billRef: string
  readonly tableName: string
  readonly occurredAt: string
  readonly staffName: string
  readonly customerName?: string | null
  readonly items: readonly PrebillItemInput[]
  readonly bill: BillDiscountFields
  readonly totals: BillTotalsView
  readonly priceTaxMode: 'INCLUSIVE' | 'EXCLUSIVE'
  readonly taxProfile: 'NONE' | 'PPN' | 'PB1'
  readonly taxRate: string
  readonly outlet: Pick<OutletRecord, 'name' | 'address' | 'phone' | 'timezone'>
  readonly receiptSetting: Pick<OutletReceiptSettingRecord, 'header_text' | 'footer_text' | 'logo_sha256'> | null
  readonly locale?: LocaleId
}

function formatPrebillTime(iso: string, tz: OutletTimezone): string {
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

/**
 * Builds a pre-bill `ReceiptDoc` (CMP-27, FR-FNB-010) strictly WITHOUT any `invoice_no`.
 */
export function buildPrebillDoc(input: BuildPrebillDocInput): ReceiptDoc {
  const locale: LocaleId = input.locale ?? 'id-ID'
  const t = i18next.getFixedT(locale)
  const tz = (input.outlet.timezone || 'Asia/Jakarta') as OutletTimezone
  const nodes: ReceiptNode[] = []

  nodes.push({ t: 'text', text: t('receipt.prebillBadge'), align: 'center', bold: true })

  if (input.receiptSetting?.logo_sha256) {
    nodes.push({ t: 'image', ref: 'logo' })
  }
  const rawHeader = input.receiptSetting?.header_text?.trim()
  if (rawHeader) {
    for (const line of rawHeader.split('\n')) {
      const clean = line.trim()
      if (clean) nodes.push({ t: 'text', text: clean, align: 'center' })
    }
  } else {
    nodes.push({ t: 'text', text: input.outlet.name, align: 'center', bold: true })
    if (input.outlet.address) nodes.push({ t: 'text', text: input.outlet.address, align: 'center' })
    if (input.outlet.phone) nodes.push({ t: 'text', text: input.outlet.phone, align: 'center' })
  }

  nodes.push({ t: 'sep' })
  nodes.push({ t: 'text', text: t('pos.prebill.billRefLine', { ref: input.billRef }), align: 'left' })
  nodes.push({ t: 'text', text: t('pos.prebill.tableLine', { table: input.tableName }), align: 'left' })
  nodes.push({ t: 'text', text: t('receipt.dateLabel', { date: formatPrebillTime(input.occurredAt, tz) }), align: 'left' })
  nodes.push({ t: 'text', text: t('pos.prebill.staffLine', { staff: input.staffName }), align: 'left' })
  if (input.customerName) {
    nodes.push({ t: 'text', text: t('receipt.customer', { name: input.customerName }), align: 'left' })
  }
  nodes.push({ t: 'sep' })

  const activeItems = input.items.filter((i) => i.status === 'ACTIVE')
  activeItems.forEach((item, idx) => {
    const lineCalc = input.totals.calc.lines[idx]
    const gross = lineCalc?.lineGross ?? Math.round(Number(item.qty) * item.unit_price)
    nodes.push({ t: 'text', text: item.item_name, align: 'left' })
    const qtyText = normalizeQty(parseQty(item.qty))
    nodes.push({
      t: 'row',
      left: ` ${qtyText} x ${formatNumberPlain(item.unit_price, locale)}`,
      right: formatNumberPlain(gross, locale),
    })
    for (const m of item.modifiers ?? []) {
      const modPrefix = m.qty > 1 ? ` + ${m.qty}x ${m.name}` : ` + ${m.name}`
      nodes.push({ t: 'text', text: modPrefix, align: 'left' })
    }
    if (lineCalc && lineCalc.lineDiscount > 0) {
      nodes.push({
        t: 'row',
        left: ` ${t('receipt.lineDiscount', { label: item.discount_type === 'PERCENT' && item.discount_pct ? `${item.discount_pct}%` : '' }).trimEnd()}`,
        right: formatNumberPlain(-lineCalc.lineDiscount, locale),
      })
    }
  })

  nodes.push({ t: 'sep' })
  nodes.push({ t: 'row', left: t('receipt.subtotal'), right: formatNumberPlain(input.totals.calc.netSubtotal, locale) })

  if (input.totals.calc.billDiscountTotal > 0) {
    nodes.push({ t: 'row', left: t('receipt.billDiscount'), right: formatNumberPlain(-input.totals.calc.billDiscountTotal, locale) })
  }
  if (input.totals.calc.serviceCharge > 0) {
    nodes.push({ t: 'row', left: t('receipt.serviceCharge'), right: formatNumberPlain(input.totals.calc.serviceCharge, locale) })
  }
  if (input.taxProfile !== 'NONE' && input.priceTaxMode !== 'INCLUSIVE' && (input.totals.calc.taxAmount > 0 || Number(input.taxRate) > 0)) {
    const rateClean = input.taxRate.includes('.') ? input.taxRate.replace(/\.?0+$/, '') : input.taxRate
    nodes.push({
      t: 'row',
      left: t('receipt.taxLine', { profile: input.taxProfile, rate: rateClean }),
      right: formatNumberPlain(input.totals.calc.taxAmount, locale),
    })
  }
  if (input.totals.roundingDelta !== 0) {
    nodes.push({ t: 'row', left: t('receipt.rounding'), right: formatNumberPlain(input.totals.roundingDelta, locale) })
  }

  nodes.push({ t: 'row', left: t('receipt.total'), right: formatNumberPlain(input.totals.calc.grandTotal, locale), bold: true })
  nodes.push({ t: 'sep' })
  nodes.push({ t: 'text', text: t('pos.prebill.notOfficialReceipt'), align: 'center' })
  nodes.push({ t: 'feed', lines: 3 })
  nodes.push({ t: 'cut' })
  return nodes
}
