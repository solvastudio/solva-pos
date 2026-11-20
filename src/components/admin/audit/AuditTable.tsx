import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  DataTable,
  Field,
  Input,
  Select,
  type DataTableColumn,
} from '~/components/ui'
import { formatDateTime, type OutletTimezone } from '~/lib/kernel'
import { AUDIT_ACTIONS, type AuditLogView, type VerifyChainStatus } from '~/modules/audit/shared'

export interface AuditTableProps {
  rows: readonly AuditLogView[]
  actionFilter: string
  fromDate: string
  toDate: string
  onActionFilterChange: (action: string) => void
  onFromDateChange: (val: string) => void
  onToDateChange: (val: string) => void
  onExportCsv: () => void | Promise<void>
  onVerifyChain: () => void | Promise<void>
  verifyResult?: VerifyChainStatus | null
  busy?: boolean
}

/**
 * Read-only audit viewer (CMP-10 / SCR-A09 Audit tab).
 * Never renders edit or delete actions on any audit entry.
 */
export function AuditTable({
  rows,
  actionFilter,
  fromDate,
  toDate,
  onActionFilterChange,
  onFromDateChange,
  onToDateChange,
  onExportCsv,
  onVerifyChain,
  verifyResult = null,
  busy = false,
}: AuditTableProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const idPrefix = useId()

  const columns: readonly DataTableColumn<AuditLogView>[] = [
    {
      id: 'seq',
      header: t('admin.audit.colSeq'),
      cell: (r) => <span className="font-mono tabular-nums">{`#${r.chainSeq}`}</span>,
    },
    {
      id: 'time',
      header: t('admin.audit.colTime'),
      cell: (r) =>
        formatDateTime(
          r.occurredAt,
          (r.outletTimezone as OutletTimezone | null) ?? 'Asia/Jakarta',
          locale,
        ),
    },
    {
      id: 'action',
      header: t('admin.audit.colAction'),
      cell: (r) => <span className="font-mono text-caption">{`${r.action}`}</span>,
    },
    {
      id: 'actor',
      header: t('admin.audit.colActor'),
      cell: (r) => r.actorName ?? r.actorUserId ?? t('common.dash'),
    },
    {
      id: 'approver',
      header: t('admin.audit.colApprover'),
      cell: (r) => r.approverName ?? r.approverUserId ?? t('common.dash'),
    },
    {
      id: 'entity',
      header: t('admin.audit.colEntity'),
      cell: (r) => `${r.entityType}${r.entityId ? ` (${r.entityId.slice(0, 8)})` : ''}`,
    },
    {
      id: 'summary',
      header: t('admin.audit.colSummary'),
      cell: (r) => {
        const parts: string[] = []
        if (r.reasonCode) parts.push(`[${r.reasonCode}]`)
        if (r.reasonText) parts.push(r.reasonText)
        if (r.afterData) parts.push(JSON.stringify(r.afterData).slice(0, 80))
        return (
          <span className="text-caption text-ink-soft">
            {parts.length > 0 ? parts.join(' · ') : t('common.dash')}
          </span>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('admin.audit.filterActionLabel')} htmlFor={`${idPrefix}-action`}>
            <Select
              id={`${idPrefix}-action`}
              value={actionFilter}
              onValueChange={onActionFilterChange}
              options={[
                { value: '', label: t('admin.audit.filterAllActions') },
                ...AUDIT_ACTIONS.map((a) => ({ value: a, label: a })),
              ]}
            />
          </Field>
          <Field label={t('admin.audit.filterFromLabel')} htmlFor={`${idPrefix}-from`}>
            <Input
              id={`${idPrefix}-from`}
              type="date"
              value={fromDate}
              onChange={(e) => onFromDateChange(e.target.value)}
            />
          </Field>
          <Field label={t('admin.audit.filterToLabel')} htmlFor={`${idPrefix}-to`}>
            <Input
              id={`${idPrefix}-to`}
              type="date"
              value={toDate}
              onChange={(e) => onToDateChange(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="md" loading={busy} onClick={onVerifyChain}>
            {t('admin.audit.verifyChainButton')}
          </Button>
          <Button type="button" variant="secondary" size="md" loading={busy} onClick={onExportCsv}>
            {t('admin.audit.exportCsvButton')}
          </Button>
        </div>
      </div>

      {verifyResult ? (
        <div
          role="status"
          className={`rounded-control p-3 text-body-sm ${
            verifyResult.ok ? 'bg-success-soft text-success-ink' : 'bg-danger-soft text-danger-ink'
          }`}
        >
          {verifyResult.ok
            ? t('admin.audit.verifyOk', { checked: verifyResult.checked })
            : t('admin.audit.verifyBroken', {
                seq: verifyResult.brokenAtSeq,
                reason: verifyResult.reason,
              })}
        </div>
      ) : null}

      <DataTable
        caption={t('admin.attention.tabAudit')}
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        emptyTitle={t('admin.audit.emptyTitle')}
      />
    </div>
  )
}
