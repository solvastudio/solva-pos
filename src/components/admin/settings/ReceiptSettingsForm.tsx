import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Chip, Field, Select } from '~/components/ui'
import type {
  OutletReceiptSettingView,
  UpdateReceiptSettingInput,
} from '~/modules/identity/shared'
import { transliterateToAscii } from '~/pos/printing/transliterate'

export interface ReceiptSettingsFormProps {
  readonly outletId: string
  readonly outletName: string
  readonly receipt: OutletReceiptSettingView | null
  readonly isPending?: boolean
  readonly onSaveReceipt: (input: UpdateReceiptSettingInput) => Promise<void>
  readonly onUploadLogo: (base64Data: string) => Promise<void>
}

function centerLine(text: string, cols: number): string {
  const clean = transliterateToAscii(text.trim()).slice(0, cols)
  const padLeft = Math.max(0, Math.floor((cols - clean.length) / 2))
  return `${' '.repeat(padLeft)}${clean}`
}

function pairLine(left: string, right: string, cols: number): string {
  const l = transliterateToAscii(left)
  const r = transliterateToAscii(right)
  const gap = Math.max(1, cols - l.length - r.length)
  return `${l.slice(0, Math.max(1, cols - r.length - 1))}${' '.repeat(gap)}${r}`
}

export function ReceiptSettingsForm({
  outletId,
  outletName,
  receipt,
  isPending = false,
  onSaveReceipt,
  onUploadLogo,
}: ReceiptSettingsFormProps) {
  const { t } = useTranslation()
  const localeId = useId()
  const headerId = useId()
  const footerId = useId()
  const logoInputId = useId()

  const [receiptLocale, setReceiptLocale] = useState<'id-ID' | 'en-US'>(
    receipt?.receiptLocale ?? 'id-ID',
  )
  const [headerText, setHeaderText] = useState(receipt?.headerText ?? '')
  const [footerText, setFooterText] = useState(receipt?.footerText ?? '')
  const [previewCols, setPreviewCols] = useState<32 | 48>(32)

  useEffect(() => {
    setReceiptLocale(receipt?.receiptLocale ?? 'id-ID')
    setHeaderText(receipt?.headerText ?? '')
    setFooterText(receipt?.footerText ?? '')
  }, [receipt])

  const previewText = useMemo(() => {
    const divider = '-'.repeat(previewCols)
    const lines: string[] = []
    if (receipt?.logoSha256) {
      lines.push(centerLine('[LOGO IMAGE]', previewCols))
    }
    lines.push(centerLine(outletName.toUpperCase(), previewCols))
    if (headerText.trim()) {
      for (const line of headerText.split('\n')) {
        lines.push(centerLine(line, previewCols))
      }
    }
    lines.push(divider)
    lines.push(pairLine('INV/2026/01-000001', '14:30', previewCols))
    lines.push(divider)
    lines.push(pairLine('1x Cafe Creme', 'Rp 28.000', previewCols))
    lines.push(pairLine('2x Croissant Beurre', 'Rp 44.000', previewCols))
    lines.push(divider)
    lines.push(pairLine('TOTAL', 'Rp 72.000', previewCols))
    lines.push(pairLine('CASH', 'Rp 100.000', previewCols))
    lines.push(pairLine('CHANGE', 'Rp 28.000', previewCols))
    if (footerText.trim()) {
      lines.push(divider)
      for (const line of footerText.split('\n')) {
        lines.push(centerLine(line, previewCols))
      }
    }
    return lines.join('\n')
  }, [footerText, headerText, outletName, previewCols, receipt?.logoSha256])

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    await onSaveReceipt({
      outletId,
      receiptLocale,
      headerText: headerText.trim() ? headerText : null,
      footerText: footerText.trim() ? footerText : null,
    })
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        void onUploadLogo(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-5">
          <div>
            <h2 className="text-h2 font-semibold text-ink">
              {t('admin.settings.receipt.sectionTitle')}
            </h2>
          </div>

          <Field label={t('admin.settings.receipt.localeLabel')} htmlFor={localeId}>
            <Select
              id={localeId}
              value={receiptLocale}
              onValueChange={(v) => setReceiptLocale(v as 'id-ID' | 'en-US')}
              options={[
                { value: 'id-ID', label: t('admin.settings.receipt.localeId') },
                { value: 'en-US', label: t('admin.settings.receipt.localeEn') },
              ]}
            />
          </Field>

          <Field label={t('admin.settings.receipt.headerLabel')} htmlFor={headerId}>
            <textarea
              id={headerId}
              rows={3}
              maxLength={600}
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body-sm text-ink focus:border-accent-solid focus:outline-none"
            />
          </Field>

          <Field label={t('admin.settings.receipt.footerLabel')} htmlFor={footerId}>
            <textarea
              id={footerId}
              rows={3}
              maxLength={600}
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body-sm text-ink focus:border-accent-solid focus:outline-none"
            />
          </Field>

          <div className="flex flex-col gap-2 rounded-control border border-line bg-surface-subtle p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-body-sm font-medium text-ink">
                {t('admin.settings.receipt.logoHeading')}
              </span>
              {receipt?.logoSha256 ? (
                <Chip
                  status="synced"
                  label={t('admin.settings.receipt.logoCurrentHash', {
                    hash: receipt.logoSha256.slice(0, 12),
                  })}
                  size="sm"
                />
              ) : (
                <Chip status="offline" label={t('admin.settings.receipt.logoNone')} size="sm" />
              )}
            </div>
            <Field label={t('admin.settings.receipt.logoUploadLabel')} htmlFor={logoInputId}>
              <input
                id={logoInputId}
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleFileChange}
                className="block w-full text-caption text-ink"
              />
            </Field>
          </div>

          <p className="text-caption text-ink-soft">{t('admin.settings.receipt.paperWidthNote')}</p>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={isPending}>
              {t('admin.settings.receipt.saveButton')}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-semibold text-ink">
            {t('admin.settings.receipt.previewHeading')}
          </h3>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={previewCols === 32 ? 'primary' : 'secondary'}
              onClick={() => setPreviewCols(32)}
            >
              {t('admin.settings.receipt.previewCols32')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={previewCols === 48 ? 'primary' : 'secondary'}
              onClick={() => setPreviewCols(48)}
            >
              {t('admin.settings.receipt.previewCols48')}
            </Button>
          </div>
        </div>

        <pre
          data-testid="receipt-preview"
          className="overflow-x-auto rounded-control border border-line bg-surface-subtle p-4 font-mono text-caption text-ink"
        >
          {previewText}
        </pre>
      </Card>
    </div>
  )
}
