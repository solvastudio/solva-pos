import { useTranslation } from 'react-i18next'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import { Chip, type DataTableColumn } from '~/components/ui'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { OpsDuplicateBillRow, OpsOrphanBillRow } from '~/modules/reporting/shared'

export interface BillReportTableProps {
  mode: 'ORPHAN' | 'DUPLICATE'
  orphanRows?: readonly OpsOrphanBillRow[]
  duplicateRows?: readonly OpsDuplicateBillRow[]
  loading?: boolean
}

export function BillReportTable({
  mode,
  orphanRows = [],
  duplicateRows = [],
  loading = false,
}: BillReportTableProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'

  const orphanColumns: readonly DataTableColumn<OpsOrphanBillRow>[] = [
    { id: 'outlet', header: t('admin.report.ops.colOutlet'), cell: (r) => r.outletCode },
    { id: 'table', header: t('admin.report.ops.colTable'), cell: (r) => <span className="font-mono">{r.tableCode}</span> },
    { id: 'billRef', header: t('admin.report.ops.colBillRef'), cell: (r) => <span className="font-mono">{r.billRef}</span> },
    { id: 'device', header: t('admin.report.ops.colDevice'), cell: (r) => r.leaseDeviceName },
    {
      id: 'reason',
      header: t('admin.report.ops.colOrphanReason'),
      cell: (r) =>
        r.deviceRevokedAt ? (
          <Chip status="device_locked" size="sm" label={t('admin.report.ops.reasonRevokedDevice')} />
        ) : (
          <Chip
            status="lease_warning"
            size="sm"
            label={t('admin.report.ops.reasonStaleHours', { hours: r.ageHours })}
          />
        ),
    },
    {
      id: 'items',
      header: t('admin.report.ops.colQty'),
      align: 'right',
      numeric: true,
      cell: (r) => <span className="font-mono tabular-nums">{r.itemCount}</span>,
    },
    {
      id: 'estTotal',
      header: t('admin.report.ops.colEstimatedTotal'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.estimatedTotal), locale)}
        </span>
      ),
    },
  ]

  const duplicateColumns: readonly DataTableColumn<OpsDuplicateBillRow>[] = [
    { id: 'date', header: t('admin.report.ops.colDate'), cell: (r) => r.businessDate },
    { id: 'outlet', header: t('admin.report.ops.colOutlet'), cell: (r) => r.outletCode },
    { id: 'table', header: t('admin.report.ops.colTable'), cell: (r) => <span className="font-mono">{r.tableCode ?? t('common.dash')}</span> },
    { id: 'billRef', header: t('admin.report.ops.colBillRef'), cell: (r) => <span className="font-mono">{r.billRef ?? r.billId.slice(0, 8)}</span> },
    { id: 'device', header: t('admin.report.ops.colDevice'), cell: (r) => r.leaseDeviceName ?? t('common.dash') },
    {
      id: 'openCount',
      header: t('admin.report.ops.colOpenCount'),
      align: 'right',
      numeric: true,
      cell: (r) => <span className="font-mono tabular-nums">{r.openCount}</span>,
    },
    {
      id: 'status',
      header: t('admin.tables.statusLabel'),
      cell: (r) => (
        <Chip
          status={r.billStatus === 'OPEN' ? 'needs_attention' : 'synced'}
          size="sm"
          label={r.billStatus ?? t('common.dash')}
        />
      ),
    },
  ]

  if (mode === 'ORPHAN') {
    return (
      <DataTableCmp10
        caption={t('admin.report.ops.tabOrphanBills', { count: orphanRows.length })}
        columns={orphanColumns}
        rows={orphanRows}
        loading={loading}
        getRowKey={(r) => r.billId}
        emptyTitle={t('admin.report.ops.emptyTitle')}
      />
    )
  }

  return (
    <DataTableCmp10
      caption={t('admin.report.ops.tabDuplicateBills', { count: duplicateRows.length })}
      columns={duplicateColumns}
      rows={duplicateRows}
      loading={loading}
      getRowKey={(r) => r.flagId}
      emptyTitle={t('admin.report.ops.emptyTitle')}
    />
  )
}
