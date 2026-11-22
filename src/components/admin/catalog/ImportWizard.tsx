import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  Chip,
  Dialog,
  Download,
  Field,
  Select,
  Stepper,
  Upload,
  useToast,
} from '~/components/ui'
import { commitImportFn, previewImportFn } from '~/functions/catalog/catalog-import.fn'
import type { CommitImportResult, ImportKind, ImportReport } from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'

const MAX_BYTES = 2 * 1024 * 1024

const TEMPLATES: Record<ImportKind, string> = {
  catalog: [
    'kategori,kode_produk,nama_produk,tipe,uom_dasar,kode_sku,label_varian,barcode,harga_default,pajak,lacak_stok,open_price,aktif',
    'Minuman,KP-100,Kopi Aren,MENU_FNB,pcs,KP-100,,8991001001,18000,Y,Y,N,Y',
    'Pakaian,KA-200,Kaos Polos,RETAIL,pcs,KA-200-S,Ukuran S,8991002001,75000,Y,Y,N,Y',
  ].join('\n'),
  price: [
    'kode_sku,uom,outlet,harga',
    'KP-100,pcs,,18000',
    'KP-100,pcs,OUT01,20000',
  ].join('\n'),
  availability: [
    'kode_produk,outlet,status,kode_sku',
    'KP-100,OUT01,AVAILABLE,',
    'KA-200,OUT01,UNAVAILABLE,KA-200-S',
  ].join('\n'),
}

function triggerDownload(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export interface ImportWizardProps {
  tenantSlug: string
}

export function ImportWizard({ tenantSlug }: ImportWizardProps) {
  const { t } = useTranslation()
  const idPrefix = useId()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [kind, setKind] = useState<ImportKind>('catalog')
  const [fileName, setFileName] = useState('import.csv')
  const [csvText, setCsvText] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [commitResult, setCommitResult] = useState<CommitImportResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const stepIndex = commitResult ? 2 : report ? 1 : 0

  const previewMut = useMutation({
    retry: 0,
    mutationFn: () => previewImportFn({ data: { kind, csvText, fileName } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      setReport(res.data)
    },
    onError: (err) => setErrorMsg(err.message),
  })

  const commitMut = useMutation({
    retry: 0,
    mutationFn: () =>
      commitImportFn({
        data: {
          kind,
          token: report?.token ?? '',
          idempotencyKey: report?.token,
        },
      }),
    onSuccess: (res) => {
      setConfirmOpen(false)
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      setCommitResult(res.data)
      queryClient.invalidateQueries({ queryKey: qk.products(tenantSlug) })
      queryClient.invalidateQueries({ queryKey: qk.priceMatrix(tenantSlug) })
      queryClient.invalidateQueries({ queryKey: qk.availabilityMatrix(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.import.doneTitle') })
    },
    onError: (err) => {
      setConfirmOpen(false)
      setErrorMsg(err.message)
    },
  })

  const totalAffected = report
    ? Object.values(report.summary).reduce((acc, c) => acc + c.create + c.update, 0)
    : 0

  function handleFileChange(file: File | null) {
    if (!file) return
    if (file.size > MAX_BYTES) {
      setErrorMsg(t('admin.import.tooLargeError'))
      return
    }
    setFileName(file.name)
    file.text().then((txt) => {
      setCsvText(txt)
      setErrorMsg(null)
    })
  }

  function downloadErrorsCsv() {
    if (!report) return
    const lines = ['row,column,code,messageKey']
    for (const err of report.errors) {
      lines.push(`${err.row},"${err.column}",${err.code},${err.messageKey}`)
    }
    triggerDownload(`errors-${fileName}`, lines.join('\n'))
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper
        ariaLabel={t('admin.import.stepsLabel')}
        activeIndex={stepIndex}
        steps={[
          { id: 'select', label: t('admin.import.stepSelect') },
          { id: 'preview', label: t('admin.import.stepPreview') },
          { id: 'done', label: t('admin.import.stepDone') },
        ]}
      />

      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      {stepIndex === 0 ? (
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-56 flex-1">
              <Field label={t('admin.import.kindLabel')} htmlFor={`${idPrefix}-kind`}>
                <Select
                  id={`${idPrefix}-kind`}
                  value={kind}
                  onValueChange={(v) => setKind(v as ImportKind)}
                  options={[
                    { value: 'catalog', label: t('admin.import.kindCatalog') },
                    { value: 'price', label: t('admin.import.kindPrice') },
                    { value: 'availability', label: t('admin.import.kindAvailability') },
                  ]}
                />
              </Field>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => triggerDownload(`template-${kind}.csv`, TEMPLATES[kind])}
            >
              <Download className="size-4" />
              {t('admin.import.downloadTemplate')}
            </Button>
          </div>

          <Field label={t('admin.import.fileLabel')} htmlFor={`${idPrefix}-file`}>
            <input
              id={`${idPrefix}-file`}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="block w-full text-body text-ink file:mr-3 file:min-h-control-md file:rounded-sm file:border file:border-line file:bg-surface-sunken file:px-3 file:text-body file:font-medium file:text-ink"
            />
          </Field>

          <Field label={t('admin.import.orPasteLabel')} htmlFor={`${idPrefix}-paste`}>
            <textarea
              id={`${idPrefix}-paste`}
              rows={8}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full rounded-sm border border-line-input bg-surface p-3 font-mono text-caption text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            />
          </Field>

          <div>
            <Button
              type="button"
              loading={previewMut.isPending}
              disabled={csvText.trim().length === 0}
              onClick={() => previewMut.mutate()}
            >
              <Upload className="size-4" />
              {t('admin.import.runPreview')}
            </Button>
          </div>
        </Card>
      ) : null}

      {stepIndex === 1 && report ? (
        <Card className="flex flex-col gap-4 p-6">
          {report.warnings.length > 0 ? (
            <div className="rounded-sm border border-warning-line bg-warning-soft p-3">
              <p className="text-caption font-semibold text-ink">{t('admin.import.warningsTitle')}</p>
              <ul className="mt-1 list-disc pl-5 text-caption text-ink-soft">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(report.summary).map(([entity, counts]) => (
              <div key={entity} className="rounded-sm border border-line bg-surface-sunken p-3">
                <p className="font-mono text-caption font-semibold text-ink">{entity}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Chip status="synced" label={t('admin.import.summaryCreate', { count: counts.create })} />
                  <Chip status="open_price" label={t('admin.import.summaryUpdate', { count: counts.update })} />
                  <Chip
                    status="inactive"
                    label={t('admin.import.summaryUnchanged', { count: counts.unchanged })}
                  />
                </div>
              </div>
            ))}
          </div>

          {!report.valid ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-h3 font-semibold text-danger-ink">
                  {t('admin.import.errorsTitle', { count: report.totalErrors })}
                </h3>
                <Button type="button" size="sm" variant="secondary" onClick={downloadErrorsCsv}>
                  <Download className="size-4" />
                  {t('admin.import.downloadErrorsCsv')}
                </Button>
              </div>
              <div className="overflow-x-auto rounded-sm border border-line">
                <table className="w-full text-left text-body">
                  <thead className="border-b border-line bg-surface-sunken text-caption font-semibold text-ink-soft">
                    <tr>
                      <th className="px-3 py-2">{t('admin.import.errorColRow')}</th>
                      <th className="px-3 py-2">{t('admin.import.errorColField')}</th>
                      <th className="px-3 py-2">{t('admin.import.errorColCode')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {report.errors.map((err, i) => (
                      <tr key={`${err.row}-${err.column}-${i}`}>
                        <td className="px-3 py-2 font-mono">{err.row}</td>
                        <td className="px-3 py-2 font-mono">{err.column}</td>
                        <td className="px-3 py-2 text-danger-ink">{err.code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setReport(null)
                setErrorMsg(null)
              }}
            >
              {t('common.back')}
            </Button>
            {report.valid && report.token ? (
              <Button
                type="button"
                loading={commitMut.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                {t('admin.import.confirmApply')}
              </Button>
            ) : null}
          </div>

          <Dialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={t('admin.import.confirmTitle')}
          >
            <p className="text-body text-ink-soft">
              {t('admin.import.confirmDesc', { count: totalAffected })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                loading={commitMut.isPending}
                onClick={() => commitMut.mutate()}
              >
                {t('admin.import.confirmApply')}
              </Button>
            </div>
          </Dialog>
        </Card>
      ) : null}

      {stepIndex === 2 && commitResult ? (
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="text-h3 font-semibold text-ink">{t('admin.import.doneTitle')}</h3>
          <p aria-live="polite" className="text-body text-ink-soft">
            {commitResult.versionBumped
              ? t('admin.import.doneVersionBumped')
              : t('admin.import.doneNoChanges')}
          </p>
          <div>
            <Button
              type="button"
              onClick={() => {
                setCommitResult(null)
                setReport(null)
                setCsvText('')
              }}
            >
              {t('admin.import.startAnother')}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  )
}
