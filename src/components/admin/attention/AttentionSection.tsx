import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  Chip,
  Dialog,
  ErrorCodeBlock,
  Field,
  Input,
} from '~/components/ui'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { AttentionItemView, PendingImportResult } from '~/modules/sync/shared'

export interface AttentionSectionProps {
  items: readonly AttentionItemView[]
  onAcceptManual: (itemId: string) => void | Promise<void>
  onDismiss: (itemId: string, reasonText: string) => void | Promise<void>
  onEscalate: (itemId: string) => void | Promise<void>
  onImportPending: (fileText: string) => void | Promise<void>
  importResult?: PendingImportResult | null
  busy?: boolean
}

export function AttentionSection({
  items,
  onAcceptManual,
  onDismiss,
  onEscalate,
  onImportPending,
  importResult = null,
  busy = false,
}: AttentionSectionProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const idPrefix = useId()

  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null)
  const [confirmAcceptId, setConfirmAcceptId] = useState<string | null>(null)
  const [dismissTargetId, setDismissTargetId] = useState<string | null>(null)
  const [dismissReason, setDismissReason] = useState('')
  const [pendingFileText, setPendingFileText] = useState('')

  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-h3 font-semibold text-ink">{t('admin.attention.importHeading')}</h2>
          <p className="text-body-sm text-ink-soft">{t('admin.attention.importHint')}</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label={t('admin.attention.importFileLabel')} htmlFor={`${idPrefix}-jsonl`}>
              <input
                id={`${idPrefix}-jsonl`}
                type="file"
                accept=".jsonl,application/x-ndjson,text/plain"
                className="block w-full text-body-sm text-ink"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  void f.text().then((txt) => setPendingFileText(txt))
                }}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="md"
            loading={busy}
            disabled={pendingFileText.trim().length === 0}
            onClick={() => void onImportPending(pendingFileText)}
          >
            {t('admin.attention.importButton')}
          </Button>
        </div>

        {importResult ? (
          <p className="rounded-control bg-info-soft p-3 text-body-sm text-info-ink" role="status">
            {t('admin.attention.importResult', {
              acked: importResult.acked,
              replayed: importResult.replayed,
              attention: importResult.attention,
              held: importResult.held,
              skipped: importResult.skipped,
            })}
          </p>
        ) : null}
      </Card>

      {items.length === 0 ? (
        <Card className="p-6">
          <h3 className="text-h3 font-semibold text-ink">{t('admin.attention.emptyTitle')}</h3>
          <p className="mt-1 text-body text-ink-soft">{t('admin.attention.emptyDesc')}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="flex flex-col gap-2 lg:col-span-5">
            {items.map((item) => {
              const active = selected?.id === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`flex flex-col items-start gap-1.5 rounded-card border p-4 text-left transition-colors ${
                    active ? 'border-line-strong bg-surface-hover' : 'border-line bg-surface'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-label font-semibold text-ink">{`${item.commandType}`}</span>
                    <Chip
                      status={item.status === 'ESCALATED' ? 'lease_warning' : 'needs_attention'}
                      label={item.status}
                      size="sm"
                    />
                  </div>
                  <span className="text-caption font-mono text-danger-ink">
                    {`${item.reasonCode}#${item.requestRef ?? item.id.slice(0, 8)}`}
                  </span>
                  {item.summary.invoiceNo ? (
                    <span className="text-caption text-ink-soft">
                      {t('admin.attention.summaryInvoice', { no: item.summary.invoiceNo })}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          <div className="lg:col-span-7">
            {selected ? (
              <Card className="flex flex-col gap-4 p-5" data-testid="attention-detail">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-h3 font-semibold text-ink">{`${selected.commandType}`}</h3>
                    <p className="text-body-sm text-ink-soft">
                      {`${t('admin.attention.deviceLabel')}: ${selected.registerCode ?? selected.registerId}`}
                    </p>
                  </div>
                  <Chip
                    status={selected.status === 'ESCALATED' ? 'lease_warning' : 'needs_attention'}
                    label={selected.status}
                    size="sm"
                  />
                </div>

                <ErrorCodeBlock
                  code={selected.reasonCode}
                  refId={selected.requestRef ?? selected.id.slice(0, 8)}
                />

                <div className="flex flex-wrap gap-3 text-body-sm text-ink">
                  {selected.summary.invoiceNo ? (
                    <span>{t('admin.attention.summaryInvoice', { no: selected.summary.invoiceNo })}</span>
                  ) : null}
                  {typeof selected.summary.totalDue === 'number' ? (
                    <span>
                      {t('admin.attention.summaryTotal', {
                        amount: formatMoney(toMoney(selected.summary.totalDue), locale),
                      })}
                    </span>
                  ) : null}
                  {typeof selected.summary.lineCount === 'number' ? (
                    <span>{t('admin.attention.summaryLines', { count: selected.summary.lineCount })}</span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  {selected.canAcceptManual ? (
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      loading={busy}
                      onClick={() => setConfirmAcceptId(selected.id)}
                    >
                      {t('admin.attention.acceptManualButton')}
                    </Button>
                  ) : null}

                  <Button
                    type="button"
                    variant="danger-outline"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      setDismissReason('')
                      setDismissTargetId(selected.id)
                    }}
                  >
                    {t('admin.attention.dismissButton')}
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() => void onEscalate(selected.id)}
                  >
                    {t('admin.attention.escalateButton')}
                  </Button>
                </div>
              </Card>
            ) : (
              <Card className="p-5 text-body text-ink-soft">
                {t('admin.attention.selectPrompt')}
              </Card>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={Boolean(confirmAcceptId)}
        onOpenChange={(open) => !open && setConfirmAcceptId(null)}
        title={t('admin.attention.acceptConfirmTitle')}
        description={t('admin.attention.acceptConfirmBody')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setConfirmAcceptId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() => {
                if (!confirmAcceptId) return
                const target = confirmAcceptId
                setConfirmAcceptId(null)
                void onAcceptManual(target)
              }}
            >
              {t('admin.attention.acceptManualButton')}
            </Button>
          </>
        }
      >
        <p className="text-body-sm text-ink-soft">{t('admin.attention.acceptConfirmBody')}</p>
      </Dialog>

      <Dialog
        open={Boolean(dismissTargetId)}
        onOpenChange={(open) => !open && setDismissTargetId(null)}
        title={t('admin.attention.dismissDialogTitle')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setDismissTargetId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={busy}
              disabled={dismissReason.trim().length === 0}
              onClick={() => {
                if (!dismissTargetId) return
                const target = dismissTargetId
                const reason = dismissReason.trim()
                setDismissTargetId(null)
                void onDismiss(target, reason)
              }}
            >
              {t('admin.attention.dismissButton')}
            </Button>
          </>
        }
      >
        <Field label={t('admin.attention.dismissReasonLabel')} htmlFor={`${idPrefix}-dismiss`}>
          <Input
            id={`${idPrefix}-dismiss`}
            value={dismissReason}
            onChange={(e) => setDismissReason(e.target.value)}
          />
        </Field>
      </Dialog>
    </div>
  )
}
