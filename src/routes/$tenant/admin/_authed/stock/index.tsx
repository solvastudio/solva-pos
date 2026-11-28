import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import {
  Button,
  buttonVariants,
  Chip,
  Dialog,
  Field,
  Select,
  useToast,
  type DataTableColumn,
} from '~/components/ui'
import { SpaLink } from '~/components/layout/SpaLink'
import { listOutletOptionsFn } from '~/functions/identity/org.fn'
import { enableOutletTrackingFn } from '~/functions/inventory/stock-write.fn'
import { getStockReportFn } from '~/functions/inventory/stock-read.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { formatMoney, toMoney } from '~/lib/kernel'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import type { R02Row } from '~/modules/inventory/public'

export const Route = createFileRoute('/$tenant/admin/_authed/stock/')({
  beforeLoad: ({ params, context }) => {
    if (!context.session?.permissions.includes('report.view')) {
      throw redirect({ href: tenantHref(params.tenant, '/admin') })
    }
  },
  component: AdminStockPage,
})

type Scope = 'ALL' | 'NEGATIVE' | 'IN_TRANSIT'

/** R-02 — Stock & Inventory Value (PRD §12 R-02). Figures come from the service; this page only displays them. */
function AdminStockPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { slug } = useCurrentTenant()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { session } = Route.useRouteContext()
  const canManageStock = session?.permissions.includes('inventory.manage') ?? false

  const [outletId, setOutletId] = useState('')
  const [scope, setScope] = useState<Scope>('ALL')
  const [availability, setAvailability] = useState<'ALL' | 'AVAILABLE' | 'UNAVAILABLE'>('ALL')
  const [activateOpen, setActivateOpen] = useState(false)
  const [activateOutletId, setActivateOutletId] = useState('')

  const outletsQuery = useQuery({
    queryKey: ['admin', slug, 'outlet-options'],
    queryFn: () => listOutletOptionsFn(),
  })

  const reportQuery = useQuery({
    queryKey: ['admin', slug, 'stock', 'r02', { outletId, scope, availability }],
    queryFn: () =>
      getStockReportFn({
        data: {
          outletId: outletId || undefined,
          onlyNegative: scope === 'NEGATIVE' || undefined,
          onlyInTransit: scope === 'IN_TRANSIT' || undefined,
          availability,
        },
      }),
  })

  const activateMut = useMutation({
    mutationFn: (id: string) => enableOutletTrackingFn({ data: { outletId: id } }),
    onSuccess: async () => {
      setActivateOpen(false)
      toast.show({ tone: 'success', message: t('admin.stock.activated') })
      await queryClient.invalidateQueries({ queryKey: ['admin', slug, 'stock'] })
    },
    onError: () => {
      toast.show({ tone: 'danger', message: t('admin.stock.activateFailed') })
    },
  })

  const report = reportQuery.data
  const outletOptions = [
    { value: '', label: t('admin.stock.allOutlets') },
    ...(outletsQuery.data ?? []).map((o) => ({ value: o.id, label: o.name || o.code })),
  ]

  const columns: readonly DataTableColumn<R02Row>[] = [
    { id: 'outlet', header: t('admin.stock.colOutlet'), cell: (r) => r.outletName || r.outletCode },
    {
      id: 'sku',
      header: t('admin.stock.colItem'),
      cell: (r) => (
        <span>
          <span className="font-mono">{r.skuCode}</span> — {r.productName}
        </span>
      ),
    },
    { id: 'qty', header: t('admin.stock.colQty'), align: 'right', numeric: true, cell: (r) => <span className="font-mono tabular-nums">{r.qty}</span> },
    {
      id: 'avg',
      header: t('admin.stock.colAvgCost'),
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono tabular-nums">{r.avgCost === null ? t('common.dash') : r.avgCost}</span>
      ),
    },
    {
      id: 'value',
      header: t('admin.stock.colValue'),
      align: 'right',
      numeric: true,
      cell: (r) => <span className="font-mono tabular-nums">{formatMoney(toMoney(r.inventoryValue), locale)}</span>,
    },
    {
      id: 'transit',
      header: t('admin.stock.colInTransit'),
      align: 'right',
      numeric: true,
      cell: (r) =>
        Number(r.qtyInTransit) > 0 ? (
          <span className="font-mono tabular-nums">
            {r.qtyInTransit} · {formatMoney(toMoney(r.valueInTransit), locale)}
          </span>
        ) : (
          t('common.dash')
        ),
    },
    {
      id: 'flags',
      header: t('admin.stock.colStatus'),
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.isNegative ? <Chip status="stock_negative" label={t('admin.stock.chipNegative')} size="sm" /> : null}
          {r.availability === 'UNAVAILABLE' ? (
            <Chip status="item_unavailable" label={t('admin.stock.chipUnavailable')} size="sm" />
          ) : null}
        </span>
      ),
    },
  ]

  const totalColumns: readonly DataTableColumn<NonNullable<typeof report>['totals'][number]>[] = [
    { id: 'outlet', header: t('admin.stock.colOutlet'), cell: (r) => r.outletName || r.outletCode },
    {
      id: 'value',
      header: t('admin.stock.colValue'),
      align: 'right',
      numeric: true,
      cell: (r) => <span className="font-mono tabular-nums">{formatMoney(toMoney(r.inventoryValue), locale)}</span>,
    },
    { id: 'neg', header: t('admin.stock.colNegativeCount'), align: 'right', numeric: true, cell: (r) => r.negativeCount },
    {
      id: 'transit',
      header: t('admin.stock.colInTransitValue'),
      align: 'right',
      numeric: true,
      cell: (r) => <span className="font-mono tabular-nums">{formatMoney(toMoney(r.valueInTransit), locale)}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-semibold text-ink">{t('admin.stock.title')}</h1>
        {canManageStock ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="md" onClick={() => setActivateOpen(true)}>
              {t('admin.stock.activateAction')}
            </Button>
            <SpaLink
              href={tenantHref(slug, '/admin/stock/documents')}
              className={buttonVariants({ variant: 'primary', size: 'md' })}
            >
              {t('admin.stock.documentsLink')}
            </SpaLink>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label={t('admin.stock.filterOutlet')} htmlFor="stock-outlet">
          <Select id="stock-outlet" options={outletOptions} value={outletId} onValueChange={setOutletId} />
        </Field>
        <Field label={t('admin.stock.filterScope')} htmlFor="stock-scope">
          <Select
            id="stock-scope"
            options={[
              { value: 'ALL', label: t('admin.stock.scopeAll') },
              { value: 'NEGATIVE', label: t('admin.stock.scopeNegative') },
              { value: 'IN_TRANSIT', label: t('admin.stock.scopeInTransit') },
            ]}
            value={scope}
            onValueChange={(v) => setScope(v as Scope)}
          />
        </Field>
        <Field label={t('admin.stock.filterAvailability')} htmlFor="stock-availability">
          <Select
            id="stock-availability"
            options={[
              { value: 'ALL', label: t('admin.stock.availAll') },
              { value: 'AVAILABLE', label: t('admin.stock.availOnly') },
              { value: 'UNAVAILABLE', label: t('admin.stock.unavailableOnly') },
            ]}
            value={availability}
            onValueChange={(v) => setAvailability(v as 'ALL' | 'AVAILABLE' | 'UNAVAILABLE')}
          />
        </Field>
      </div>

      {reportQuery.isError ? (
        <p role="alert" className="text-body text-danger-ink">{t('admin.stock.loadFailed')}</p>
      ) : null}

      {report ? (
        <>
          <DataTableCmp10
            caption={t('admin.stock.totalsCaption')}
            columns={totalColumns}
            rows={report.totals}
            getRowKey={(r) => r.outletId}
            emptyTitle={t('admin.stock.emptyTitle')}
          />
          <DataTableCmp10
            caption={t('admin.stock.balanceCaption')}
            columns={columns}
            rows={report.rows}
            getRowKey={(r) => `${r.outletId}:${r.skuId}`}
            emptyTitle={t('admin.stock.emptyTitle')}
          />
        </>
      ) : null}

      <Dialog
        open={activateOpen}
        onOpenChange={setActivateOpen}
        title={t('admin.stock.activateTitle')}
        description={t('admin.stock.activateDescription')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => setActivateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!activateOutletId}
              loading={activateMut.isPending}
              onClick={() => activateMut.mutate(activateOutletId)}
            >
              {t('admin.stock.activateConfirm')}
            </Button>
          </div>
        }
      >
        <Field label={t('admin.stock.filterOutlet')} htmlFor="stock-activate-outlet">
          <Select
            id="stock-activate-outlet"
            options={[{ value: '', label: t('admin.stock.chooseOutlet') }, ...(outletsQuery.data ?? []).map((o) => ({ value: o.id, label: o.name || o.code }))]}
            value={activateOutletId}
            onValueChange={setActivateOutletId}
          />
        </Field>
      </Dialog>
    </div>
  )
}

export { tenantHref }
