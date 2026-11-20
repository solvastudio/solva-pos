import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Chip,
  DataTable,
  Dialog,
  Field,
  Input,
  type DataTableColumn,
} from '~/components/ui'
import type { InvoiceGapRow } from '~/modules/sales/shared'

export interface GapTableProps {
  gaps: readonly InvoiceGapRow[]
  canAnnotate: boolean
  onAnnotate: (gapId: string, reasonText: string) => void | Promise<void>
  busy?: boolean
}

export function GapTable({ gaps, canAnnotate, onAnnotate, busy = false }: GapTableProps) {
  const { t } = useTranslation()
  const idPrefix = useId()
  const [targetGapId, setTargetGapId] = useState<string | null>(null)
  const [reasonText, setReasonText] = useState('')

  const columns: readonly DataTableColumn<InvoiceGapRow>[] = [
    {
      id: 'register',
      header: t('admin.attention.gaps.colRegister'),
      cell: (g) => <span className="font-mono text-caption">{`${g.registerId.slice(0, 8)}`}</span>,
    },
    {
      id: 'docType',
      header: t('admin.attention.gaps.colDocType'),
      cell: (g) => `${g.docType}`,
    },
    {
      id: 'period',
      header: t('admin.attention.gaps.colPeriod'),
      cell: (g) => <span className="font-mono">{`${g.period}`}</span>,
    },
    {
      id: 'range',
      header: t('admin.attention.gaps.colRange'),
      cell: (g) => (
        <span className="font-mono tabular-nums">
          {g.seqFrom === g.seqTo ? `#${g.seqFrom}` : `#${g.seqFrom} – #${g.seqTo}`}
        </span>
      ),
    },
    {
      id: 'origin',
      header: t('admin.attention.gaps.colOrigin'),
      cell: (g) => `${g.origin}`,
    },
    {
      id: 'status',
      header: t('admin.attention.gaps.colStatus'),
      cell: (g) => (
        <Chip
          status={g.status === 'OPEN' ? 'lease_warning' : 'synced'}
          label={g.status}
          size="sm"
        />
      ),
    },
    {
      id: 'reason',
      header: t('admin.attention.gaps.colReason'),
      cell: (g) => g.reasonText ?? t('common.dash'),
    },
    {
      id: 'action',
      header: t('admin.attention.gaps.colAction'),
      align: 'right',
      cell: (g) =>
        canAnnotate && g.status === 'OPEN' ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setReasonText('')
              setTargetGapId(g.id)
            }}
          >
            {t('admin.attention.gaps.annotateButton')}
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption={t('admin.attention.tabGaps')}
        columns={columns}
        rows={gaps}
        getRowKey={(r) => r.id}
        emptyTitle={t('admin.attention.gaps.emptyTitle')}
      />

      <Dialog
        open={Boolean(targetGapId)}
        onOpenChange={(open) => !open && setTargetGapId(null)}
        title={t('admin.attention.gaps.dialogTitle')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setTargetGapId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={reasonText.trim().length === 0}
              onClick={() => {
                if (!targetGapId) return
                const id = targetGapId
                const note = reasonText.trim()
                setTargetGapId(null)
                void onAnnotate(id, note)
              }}
            >
              {t('admin.attention.gaps.saveButton')}
            </Button>
          </>
        }
      >
        <Field label={t('admin.attention.gaps.reasonLabel')} htmlFor={`${idPrefix}-gap-note`}>
          <Input
            id={`${idPrefix}-gap-note`}
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
          />
        </Field>
      </Dialog>
    </div>
  )
}
