import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BillReportTable } from '~/components/admin/fnb/BillReportTable'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import { ReportBusy } from '~/components/admin/reports/ReportBusy'
import { ReportFilters } from '~/components/admin/reports/ReportFilters'
import {
  downloadReportCsvFile,
  getDefaultReportDateRange,
} from '~/components/admin/reports/report-download'
import { SpaLink } from '~/components/layout/SpaLink'
import { Chip, Tabs, useToast, type DataTableColumn, type TabItem } from '~/components/ui'
import { listOutletOptionsFn } from '~/functions/identity/org.fn'
import { exportReportCsvFn, getOpsReportFn } from '~/functions/reporting/reports.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { formatMoney, toMoney } from '~/lib/kernel'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import type {
  OpsAttentionRow,
  OpsFlagLineRow,
  OpsGapInvoiceRow,
  OpsItemUnavailableRow,
  OpsNomorKonflikRow,
  OpsOpenPriceRow,
  OpsSelisihHitungRow,
  OpsStaleHargaRow,
} from '~/modules/reporting/shared'

export const Route = createFileRoute('/$tenant/admin/_authed/reports/operations')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('report.view')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  component: AdminOperationsReportPage,
})

function AdminOperationsReportPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { slug } = useCurrentTenant()
  const toast = useToast()

  const defaults = getDefaultReportDateRange()
  const [selectedOutletId, setSelectedOutletId] = useState('')
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [activeTab, setActiveTab] = useState('staleHarga')
  const [appliedFilter, setAppliedFilter] = useState({
    outletId: '',
    from: defaults.from,
    to: defaults.to,
  })

  const outletsQuery = useQuery({
    queryKey: ['admin', slug, 'outlet-options'],
    queryFn: () => listOutletOptionsFn(),
  })

  const reportQuery = useQuery({
    queryKey: ['admin', slug, 'report-ops', appliedFilter],
    queryFn: () =>
      getOpsReportFn({
        data: {
          outletIds: appliedFilter.outletId ? [appliedFilter.outletId] : [],
          from: appliedFilter.from,
          to: appliedFilter.to,
          groupBy: 'DAY',
        },
      }),
  })

  const exportMut = useMutation({
    mutationFn: () =>
      exportReportCsvFn({
        data: {
          kind: 'operations',
          filter: {
            outletIds: appliedFilter.outletId ? [appliedFilter.outletId] : [],
            from: appliedFilter.from,
            to: appliedFilter.to,
            groupBy: 'DAY',
          },
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.show({ tone: 'warning', message: t('admin.report.busy') })
        return
      }
      downloadReportCsvFile(res.data.csv, res.data.filename)
    },
  })

  const outcome = reportQuery.data
  const isBusy = Boolean(outcome && !outcome.ok && outcome.busy)
  const rpt = outcome && outcome.ok ? outcome.data : null

  const staleColumns: readonly DataTableColumn<OpsStaleHargaRow>[] = [
    { id: 'date', header: t('admin.report.ops.colDate'), cell: (r) => r.businessDate },
    { id: 'outlet', header: t('admin.report.ops.colOutlet'), cell: (r) => r.outletCode },
    {
      id: 'invoice',
      header: t('admin.report.ops.colInvoice'),
      cell: (r) => <span className="font-mono">{r.invoiceNo}</span>,
    },
    {
      id: 'item',
      header: t('admin.report.ops.colItem'),
      cell: (r) => `${r.skuCode} — ${r.itemName}`,
    },
    { id: 'qty', header: t('admin.report.ops.colQty'), align: 'right', cell: (r) => r.qty },
    {
      id: 'unitPrice',
      header: t('admin.report.ops.colUnitPrice'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.unitPrice), locale)}
        </span>
      ),
    },
    {
      id: 'diff',
      header: t('admin.report.ops.colDiff'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.diffAmount), locale)}
        </span>
      ),
    },
    {
      id: 'phone',
      header: t('admin.report.ops.colPhone'),
      cell: (r) => <span className="font-mono">{r.customerPhone ?? t('common.dash')}</span>,
    },
  ]

  const flagLineColumns: readonly DataTableColumn<OpsFlagLineRow>[] = [
    { id: 'date', header: t('admin.report.ops.colDate'), cell: (r) => r.businessDate },
    { id: 'outlet', header: t('admin.report.ops.colOutlet'), cell: (r) => r.outletCode },
    {
      id: 'flag',
      header: t('admin.report.ops.colFlag'),
      cell: (r) => <Chip status="flag_warning" label={r.flagCode} size="sm" />,
    },
    {
      id: 'invoice',
      header: t('admin.report.ops.colInvoice'),
      cell: (r) => <span className="font-mono">{r.invoiceNo}</span>,
    },
    {
      id: 'item',
      header: t('admin.report.ops.colItem'),
      cell: (r) =>
        r.skuCode && r.itemName ? `${r.skuCode} — ${r.itemName}` : t('common.dash'),
    },
    {
      id: 'phone',
      header: t('admin.report.ops.colPhone'),
      cell: (r) => <span className="font-mono">{r.customerPhone ?? t('common.dash')}</span>,
    },
  ]

  const selisihColumns: readonly DataTableColumn<OpsSelisihHitungRow>[] = [
    { id: 'date', header: t('admin.report.ops.colDate'), cell: (r) => r.businessDate },
    { id: 'outlet', header: t('admin.report.ops.colOutlet'), cell: (r) => r.outletCode },
    {
      id: 'invoice',
      header: t('admin.report.ops.colInvoice'),
      cell: (r) => <span className="font-mono">{r.invoiceNo}</span>,
    },
    {
      id: 'diff',
      header: t('admin.report.ops.colDiff'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.diffAmount), locale)}
        </span>
      ),
    },
    {
      id: 'detail',
      header: t('admin.report.ops.colDetail'),
      cell: (r) => (
        <span className="font-mono text-caption">
          {`${r.clientTotal ?? '-'} vs ${r.serverTotal ?? '-'}`}
        </span>
      ),
    },
    {
      id: 'phone',
      header: t('admin.report.ops.colPhone'),
      cell: (r) => <span className="font-mono">{r.customerPhone ?? t('common.dash')}</span>,
    },
  ]

  const konflikColumns: readonly DataTableColumn<OpsNomorKonflikRow>[] = [
    { id: 'date', header: t('admin.report.ops.colDate'), cell: (r) => r.businessDate },
    { id: 'outlet', header: t('admin.report.ops.colOutlet'), cell: (r) => r.outletCode },
    {
      id: 'invoice',
      header: t('admin.report.ops.colInvoice'),
      cell: (r) => <span className="font-mono">{r.documentNo}</span>,
    },
    {
      id: 'detail',
      header: t('admin.report.ops.colDetail'),
      cell: (r) => <span className="font-mono">{r.originalNo ?? t('common.dash')}</span>,
    },
    {
      id: 'phone',
      header: t('admin.report.ops.colPhone'),
      cell: (r) => <span className="font-mono">{r.customerPhone ?? t('common.dash')}</span>,
    },
  ]

  const gapColumns: readonly DataTableColumn<OpsGapInvoiceRow>[] = [
    { id: 'outlet', header: t('admin.report.ops.colOutlet'), cell: (r) => r.outletCode },
    {
      id: 'register',
      header: t('admin.attention.gaps.colRegister'),
      cell: (r) => <span className="font-mono">{r.registerCode}</span>,
    },
    { id: 'docType', header: t('admin.attention.gaps.colDocType'), cell: (r) => r.docType },
    { id: 'period', header: t('admin.attention.gaps.colPeriod'), cell: (r) => r.period },
    {
      id: 'range',
      header: t('admin.attention.gaps.colRange'),
      cell: (r) => <span className="font-mono">{`#${r.seqFrom} – #${r.seqTo}`}</span>,
    },
    {
      id: 'reason',
      header: t('admin.attention.gaps.colReason'),
      cell: (r) => r.reasonText ?? t('common.dash'),
    },
  ]

  const attentionColumns: readonly DataTableColumn<OpsAttentionRow>[] = [
    { id: 'outlet', header: t('admin.report.ops.colOutlet'), cell: (r) => r.outletCode },
    {
      id: 'invoice',
      header: t('admin.report.ops.colInvoice'),
      cell: (r) => (
        <SpaLink
          href={tenantHref(slug, '/admin/attention')}
          className="font-mono text-ink-brand hover:underline"
        >
          {r.invoiceNo ?? r.commandId.slice(0, 8)}
        </SpaLink>
      ),
    },
    {
      id: 'flag',
      header: t('admin.report.ops.colFlag'),
      cell: (r) => <span className="font-mono">{`${r.reasonClass}: ${r.reasonCode}`}</span>,
    },
    {
      id: 'amount',
      header: t('admin.report.sales.colAmount'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {r.totalDue !== null ? formatMoney(toMoney(r.totalDue), locale) : t('common.dash')}
        </span>
      ),
    },
  ]

  const unavailableColumns: readonly DataTableColumn<OpsItemUnavailableRow>[] = [
    { id: 'date', header: t('admin.report.ops.colDate'), cell: (r) => r.businessDate },
    { id: 'outlet', header: t('admin.report.ops.colOutlet'), cell: (r) => r.outletCode },
    {
      id: 'invoice',
      header: t('admin.report.ops.colInvoice'),
      cell: (r) => <span className="font-mono">{r.invoiceNo}</span>,
    },
    {
      id: 'item',
      header: t('admin.report.ops.colItem'),
      cell: (r) => `${r.skuCode} — ${r.itemName}`,
    },
    { id: 'qty', header: t('admin.report.ops.colQty'), align: 'right', cell: (r) => r.qty },
    {
      id: 'gross',
      header: t('admin.report.ops.colLineGross'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.lineGross), locale)}
        </span>
      ),
    },
    {
      id: 'phone',
      header: t('admin.report.ops.colPhone'),
      cell: (r) => <span className="font-mono">{r.customerPhone ?? t('common.dash')}</span>,
    },
  ]

  const openPriceColumns: readonly DataTableColumn<OpsOpenPriceRow>[] = [
    { id: 'date', header: t('admin.report.ops.colDate'), cell: (r) => r.businessDate },
    { id: 'outlet', header: t('admin.report.ops.colOutlet'), cell: (r) => r.outletCode },
    {
      id: 'invoice',
      header: t('admin.report.ops.colInvoice'),
      cell: (r) => <span className="font-mono">{r.invoiceNo}</span>,
    },
    {
      id: 'item',
      header: t('admin.report.ops.colItem'),
      cell: (r) => `${r.skuCode} — ${r.itemName}`,
    },
    { id: 'qty', header: t('admin.report.ops.colQty'), align: 'right', cell: (r) => r.qty },
    {
      id: 'unitPrice',
      header: t('admin.report.ops.colUnitPrice'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {formatMoney(toMoney(r.unitPrice), locale)}
        </span>
      ),
    },
    { id: 'cashier', header: t('admin.report.ops.colCashier'), cell: (r) => r.cashierName },
    {
      id: 'phone',
      header: t('admin.report.ops.colPhone'),
      cell: (r) => <span className="font-mono">{r.customerPhone ?? t('common.dash')}</span>,
    },
  ]

  const sec = rpt?.sections

  const tabItems: readonly TabItem[] = sec
    ? [
        {
          value: 'staleHarga',
          label: t('admin.report.ops.tabStaleHarga', { count: sec.staleHarga.length }),
          content: (
            <div className="mt-4">
              <DataTableCmp10
                caption={t('admin.report.ops.tabStaleHarga', { count: sec.staleHarga.length })}
                columns={staleColumns}
                rows={sec.staleHarga}
                getRowKey={(r) => r.flagId}
                emptyTitle={t('admin.report.ops.emptyTitle')}
              />
            </div>
          ),
        },
        {
          value: 'itemNonaktifTarifBeda',
          label: t('admin.report.ops.tabNonaktifTarif', {
            count: sec.itemNonaktifTarifBeda.length,
          }),
          content: (
            <div className="mt-4">
              <DataTableCmp10
                caption={t('admin.report.ops.tabNonaktifTarif', {
                  count: sec.itemNonaktifTarifBeda.length,
                })}
                columns={flagLineColumns}
                rows={sec.itemNonaktifTarifBeda}
                getRowKey={(r) => r.flagId}
                emptyTitle={t('admin.report.ops.emptyTitle')}
              />
            </div>
          ),
        },
        {
          value: 'selisihHitung',
          label: t('admin.report.ops.tabSelisihHitung', { count: sec.selisihHitung.length }),
          content: (
            <div className="mt-4">
              <DataTableCmp10
                caption={t('admin.report.ops.tabSelisihHitung', {
                  count: sec.selisihHitung.length,
                })}
                columns={selisihColumns}
                rows={sec.selisihHitung}
                getRowKey={(r) => r.flagId}
                emptyTitle={t('admin.report.ops.emptyTitle')}
              />
            </div>
          ),
        },
        {
          value: 'nomorKonflik',
          label: t('admin.report.ops.tabNomorKonflik', { count: sec.nomorKonflik.length }),
          content: (
            <div className="mt-4">
              <DataTableCmp10
                caption={t('admin.report.ops.tabNomorKonflik', {
                  count: sec.nomorKonflik.length,
                })}
                columns={konflikColumns}
                rows={sec.nomorKonflik}
                getRowKey={(r) => r.flagId}
                emptyTitle={t('admin.report.ops.emptyTitle')}
              />
            </div>
          ),
        },
        {
          value: 'gapInvoice',
          label: t('admin.report.ops.tabGapInvoice', { count: sec.gapInvoice.length }),
          content: (
            <div className="mt-4">
              <DataTableCmp10
                caption={t('admin.report.ops.tabGapInvoice', { count: sec.gapInvoice.length })}
                columns={gapColumns}
                rows={sec.gapInvoice}
                getRowKey={(r) => r.gapId}
                emptyTitle={t('admin.report.ops.emptyTitle')}
              />
            </div>
          ),
        },
        {
          value: 'attention',
          label: t('admin.report.ops.tabAttention', { count: sec.attention.length }),
          content: (
            <div className="mt-4">
              <DataTableCmp10
                caption={t('admin.report.ops.tabAttention', { count: sec.attention.length })}
                columns={attentionColumns}
                rows={sec.attention}
                getRowKey={(r) => r.attentionId}
                emptyTitle={t('admin.report.ops.emptyTitle')}
              />
            </div>
          ),
        },
        {
          value: 'itemTidakTersedia',
          label: t('admin.report.ops.tabItemUnavailable', {
            count: sec.itemTidakTersedia.length,
          }),
          content: (
            <div className="mt-4">
              <DataTableCmp10
                caption={t('admin.report.ops.tabItemUnavailable', {
                  count: sec.itemTidakTersedia.length,
                })}
                columns={unavailableColumns}
                rows={sec.itemTidakTersedia}
                getRowKey={(r) => r.flagId}
                emptyTitle={t('admin.report.ops.emptyTitle')}
              />
            </div>
          ),
        },
        {
          value: 'openPrice',
          label: t('admin.report.ops.tabOpenPrice', { count: sec.openPrice.length }),
          content: (
            <div className="mt-4">
              <DataTableCmp10
                caption={t('admin.report.ops.tabOpenPrice', { count: sec.openPrice.length })}
                columns={openPriceColumns}
                rows={sec.openPrice}
                getRowKey={(r) => r.saleLineId}
                emptyTitle={t('admin.report.ops.emptyTitle')}
              />
            </div>
          ),
        },
        {
          value: 'orphanBills',
          label: t('admin.report.ops.tabOrphanBills', { count: sec.orphanBills.length }),
          content: (
            <div className="mt-4">
              <BillReportTable mode="ORPHAN" orphanRows={sec.orphanBills} />
            </div>
          ),
        },
        {
          value: 'duplicateBills',
          label: t('admin.report.ops.tabDuplicateBills', { count: sec.duplicateBills.length }),
          content: (
            <div className="mt-4">
              <BillReportTable mode="DUPLICATE" duplicateRows={sec.duplicateBills} />
            </div>
          ),
        },
      ]
    : []

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold text-ink">{t('admin.report.ops.title')}</h1>

      <ReportFilters
        outlets={outletsQuery.data ?? []}
        selectedOutletId={selectedOutletId}
        from={from}
        to={to}
        loading={reportQuery.isFetching || exportMut.isPending}
        busy={isBusy}
        onOutletChange={setSelectedOutletId}
        onFromChange={setFrom}
        onToChange={setTo}
        onSubmit={() => {
          setAppliedFilter({ outletId: selectedOutletId, from, to })
        }}
        onExportCsv={() => exportMut.mutate()}
      />

      {isBusy ? (
        <ReportBusy
          loading={reportQuery.isFetching}
          onRetry={() => {
            void reportQuery.refetch()
          }}
        />
      ) : null}

      {sec ? (
        <Tabs
          items={tabItems}
          value={activeTab}
          onValueChange={setActiveTab}
          size="md"
          ariaLabel={t('admin.report.ops.tabsLabel')}
        />
      ) : null}
    </div>
  )
}
